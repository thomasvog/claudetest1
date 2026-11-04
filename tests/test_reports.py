import base64
import io
import re
import unittest
import zlib
from contextlib import nullcontext
from datetime import date, timedelta
from unittest.mock import patch

from PIL import Image
from reportlab.platypus import Paragraph, Table
from werkzeug.exceptions import BadRequest

import api.index as backend


class CursorResult:
    def __init__(self, value):
        self.value = value

    def fetchone(self):
        return self.value


class ReadOnlyDatabase:
    def transaction(self):
        return nullcontext()

    def execute(self, statement, *params):
        if "SELECT role, active, name FROM users WHERE id=%s" in statement:
            return CursorResult({"role": backend.session.get("role"), "active": True, "name": "Usuario de prueba"})
        if statement != "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY":
            raise AssertionError("El informe debe usar una transacción de solo lectura")
        return CursorResult(None)


class FindingDeletionDatabase:
    def __init__(self, deleted_id=41):
        self.deleted_id = deleted_id
        self.statements = []

    def execute(self, statement, params=()):
        self.statements.append((statement, params))
        if "SELECT role, active, name FROM users WHERE id=%s" in statement:
            return CursorResult({"role": backend.session.get("role"), "active": True, "name": "Usuario de prueba"})
        if statement == "DELETE FROM findings WHERE id=%s RETURNING id":
            return CursorResult({"id": self.deleted_id} if self.deleted_id else None)
        raise AssertionError("Consulta inesperada al eliminar un hallazgo")


def finding(status="solucionado", finding_id=41):
    today = date.today()
    return {
        "id": finding_id,
        "tag": "HAZ-041",
        "status": status,
        "criticality": "alta",
        "finding_type": "Deterioro",
        "equipment_type": None,
        "equipment_location": None,
        "zone": "21",
        "protection": "Ex d",
        "inspected_at": today - timedelta(days=8),
        "closed_at": today - timedelta(days=3) if status == "solucionado" else None,
        "area": "Extrusión",
        "description": "Descripción <segura> del hallazgo",
        "resolution": "Se sustituyó el componente",
        "closer": "Responsable de cierre",
        "inspector": "Inspector de prueba",
        "ot": "OT-41",
    }


def image_bytes(size=(40, 30)):
    buf = io.BytesIO()
    Image.new("RGB", size, (20, 80, 60)).save(buf, format="JPEG")
    return buf.getvalue()


class ReportEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.old_url = backend.URL
        cls.old_ready = backend._ready
        cls.old_testing = backend.app.config.get("TESTING")
        backend.URL = "postgresql://test-only"
        backend._ready = True
        backend.app.config["TESTING"] = True

    @classmethod
    def tearDownClass(cls):
        backend.URL = cls.old_url
        backend._ready = cls.old_ready
        backend.app.config["TESTING"] = cls.old_testing

    def client_for(self, role=None):
        client = backend.app.test_client()
        with client.session_transaction() as sess:
            sess["csrf"] = "csrf-de-prueba"
            if role:
                sess["uid"] = 1
                sess["role"] = role
                sess["name"] = "Usuario de prueba"
        return client

    def delete_finding(self, client):
        return client.delete("/api/findings/41", headers={"X-CSRF-Token": "csrf-de-prueba"})

    def test_deleting_finding_requires_admin_role(self):
        for role, expected_status in ((None, 401), ("tecnico", 403), ("supervisor", 403)):
            with self.subTest(role=role):
                db = FindingDeletionDatabase()
                with patch.object(backend, "db", return_value=db):
                    response = self.delete_finding(self.client_for(role))
                self.assertEqual(response.status_code, expected_status)
                self.assertFalse(any("DELETE FROM findings" in sql for sql, _ in db.statements))

    def test_admin_can_delete_finding_and_missing_finding_returns_404(self):
        for deleted_id, expected_status in ((41, 200), (None, 404)):
            with self.subTest(deleted_id=deleted_id):
                db = FindingDeletionDatabase(deleted_id=deleted_id)
                with patch.object(backend, "db", return_value=db):
                    response = self.delete_finding(self.client_for("admin"))
                self.assertEqual(response.status_code, expected_status)
                self.assertEqual(
                    [entry for entry in db.statements if "DELETE FROM findings" in entry[0]],
                    [("DELETE FROM findings WHERE id=%s RETURNING id", (41,))],
                )

    def test_finding_creation_rejects_non_numeric_ot(self):
        with patch.object(backend, "types_list", return_value=[]):
            values, error = backend.read_finding({"ot": "OT-41"})
        self.assertIsNone(values)
        self.assertEqual(error, "El N° de OT solo puede contener números.")

    def test_generic_equipment_finding_accepts_element_and_plant_location(self):
        equipment = {
            "id": 9, "tag": "MAC BAGGING", "protection": None,
            "location_id": None, "zone": None,
        }
        db = type("EquipmentDatabase", (), {
            "execute": lambda self, statement, params: CursorResult(equipment),
        })()
        form = {
            "equipment_id": "9", "location_id": "1", "zone": "1", "criticality": "media",
            "finding_type": "Deterioro", "inspected_at": date.today().isoformat(),
            "equipment_type": "Caja de derivación", "equipment_location": "Nave 2, columna B-4",
        }
        with patch.object(backend, "db", return_value=db), patch.object(backend, "types_list", return_value=[{"name": "Deterioro"}]):
            values, error = backend.read_finding(form)
        self.assertIsNone(error)
        self.assertEqual(values["equipment_type"], "Caja de derivación")
        self.assertEqual(values["equipment_location"], "Nave 2, columna B-4")

    def test_generic_equipment_finding_rejects_unknown_element_type(self):
        equipment = {
            "id": 9, "tag": "MAC BAGGING", "protection": None,
            "location_id": None, "zone": None,
        }
        db = type("EquipmentDatabase", (), {
            "execute": lambda self, statement, params: CursorResult(equipment),
        })()
        form = {
            "equipment_id": "9", "location_id": "1", "zone": "1", "criticality": "media",
            "finding_type": "Deterioro", "inspected_at": date.today().isoformat(),
            "equipment_type": "Otro elemento",
        }
        with patch.object(backend, "db", return_value=db), patch.object(backend, "types_list", return_value=[{"name": "Deterioro"}]):
            values, error = backend.read_finding(form)
        self.assertIsNone(values)
        self.assertEqual(error, "Elegí un tipo de elemento válido.")

    def test_closing_finding_rejects_non_numeric_ot(self):
        with backend.app.test_request_context(
            "/api/findings/41/close", method="POST", data={"resolution": "Reparación", "ot": "OT-41"}
        ):
            values, error = backend.closing_values({"ot": None})
        self.assertIsNone(values)
        self.assertEqual(error, "El N° de OT solo puede contener números.")

    def fake_rows(self, sql, *params):
        if "FROM photos" in sql:
            return [{"id": 9, "kind": "despues", "data": image_bytes()}]
        if "WHERE f.status=%s" in sql:
            status, _, offset = params
            return [finding(status)] if offset == 0 else []
        if "GROUP BY criticality" in sql:
            return [
                {"criticality": "alta", "count": 1},
            ]
        if "GROUP BY l.name" in sql:
            return [
                {"area": "Extrusión", "total": 2, "pending": 1, "solved": 1},
                {"area": "Servicios", "total": 1, "pending": 0, "solved": 1},
            ]
        if "date_trunc('month'" in sql:
            if "AS month_label" not in sql:
                raise AssertionError("El período mensual debe usar un alias compatible con PostgreSQL")
            return [
                {"month_label": date.today().strftime("%Y-%m"), "count": 2},
                {"month_label": (date.today().replace(day=1) - timedelta(days=1)).strftime("%Y-%m"), "count": 1},
            ]
        return []

    def fake_one(self, sql, *params):
        if "WHERE f.id=%s" in sql:
            return finding("solucionado", params[0])
        return {"total": 3, "pending": 1, "solved": 2, "overdue": 1, "aged_15_30": 1, "average_days": 5.0}

    def assert_pdf_response(self, response):
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "application/pdf")
        self.assertTrue(response.data.startswith(b"%PDF-"))
        self.assertTrue(response.data.rstrip().endswith(b"%%EOF"))
        self.assertIn(b"/Width 407", response.data)
        self.assertIn(b"/Height 132", response.data)

    def decoded_pdf_streams(self, pdf):
        decoded = []
        for match in re.finditer(rb"stream\r?\n(.*?)endstream", pdf, re.S):
            stream = match.group(1).rstrip(b"\r\n")
            try:
                stream = base64.a85decode(stream.rstrip(b"~>"), adobe=False)
            except ValueError:
                pass
            try:
                decoded.append(zlib.decompress(stream))
            except zlib.error:
                decoded.append(stream)
        return decoded

    def report_story_text(self, flowables):
        text = []
        for flowable in flowables:
            if isinstance(flowable, Table):
                text.append(self.report_story_text(
                    cell for row in flowable._cellvalues for cell in row
                    if cell is not None
                ))
            elif isinstance(flowable, Paragraph):
                text.append(flowable.text)
            elif isinstance(flowable, str):
                text.append(flowable)
        return " ".join(text)

    def test_individual_pdf_is_available_to_each_authenticated_role(self):
        with patch.object(backend, "db", return_value=ReadOnlyDatabase()), \
             patch.object(backend, "one", side_effect=self.fake_one), \
             patch.object(backend, "rows", side_effect=self.fake_rows):
            for role in ("tecnico", "supervisor", "admin"):
                with self.subTest(role=role):
                    response = self.client_for(role).get("/api/reports/findings/41.pdf")
                    self.assert_pdf_response(response)
                    self.assertIn("hallazgo-41-solucionado.pdf", response.headers["Content-Disposition"])
                    self.assertEqual(response.headers["Cache-Control"], "private, no-store")
                    self.assertEqual(len(re.findall(rb"/Type\s*/Page\b", response.data)), 1)

    def test_long_individual_pdf_stays_on_one_a4_page(self):
        record = finding("solucionado")
        record["description"] = "Descripción extensa del hallazgo. " * 120
        record["resolution"] = "Acción correctiva detallada. " * 100
        photos = [{"id": n, "kind": "antes" if n % 2 else "despues",
                   "data": image_bytes((30, 40)) if n % 2 else image_bytes()} for n in range(1, 13)]
        with patch.object(backend, "db", return_value=ReadOnlyDatabase()), \
             patch.object(backend, "one", return_value=record), \
             patch.object(backend, "rows", return_value=photos):
            response = self.client_for("tecnico").get("/api/reports/findings/41.pdf")
        self.assert_pdf_response(response)
        self.assertEqual(len(re.findall(rb"/Type\s*/Page\b", response.data)), 1)
        box = re.search(rb"/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]", response.data)
        self.assertIsNotNone(box)
        self.assertAlmostEqual(float(box.group(1)), 595.28, delta=0.1)
        self.assertAlmostEqual(float(box.group(2)), 841.89, delta=0.1)

    def test_portrait_photo_frame_is_taller_than_landscape(self):
        landscape_frame = backend.report_photo_max_size(40, 30)
        portrait_frame = backend.report_photo_max_size(30, 40)
        self.assertEqual(portrait_frame[0], landscape_frame[0])
        self.assertGreater(portrait_frame[1], landscape_frame[1])
        single_photo_frame = backend.report_photo_max_size(40, 30, single_photo=True)
        self.assertGreater(single_photo_frame[0], landscape_frame[0])

    def test_individual_pdf_rejects_pending_finding(self):
        with patch.object(backend, "db", return_value=ReadOnlyDatabase()), \
             patch.object(backend, "one", return_value=finding("pendiente")), \
             patch.object(backend, "rows", return_value=[]):
            response = self.client_for("tecnico").get("/api/reports/findings/41.pdf")
        self.assertEqual(response.status_code, 409)

    def test_general_pdf_endpoints_require_supervisor_or_admin(self):
        endpoints = ("pending", "solved", "executive")
        for endpoint in endpoints:
            path = "/api/reports/%s.pdf" % endpoint
            self.assertEqual(self.client_for().get(path).status_code, 401)
            with patch.object(backend, "db", return_value=ReadOnlyDatabase()):
                self.assertEqual(self.client_for("tecnico").get(path).status_code, 403)
            with patch.object(backend, "db", return_value=ReadOnlyDatabase()), \
                 patch.object(backend, "one", side_effect=self.fake_one), \
                 patch.object(backend, "rows", side_effect=self.fake_rows):
                for role in ("supervisor", "admin"):
                    with self.subTest(endpoint=endpoint, role=role):
                        response = self.client_for(role).get(path)
                        self.assert_pdf_response(response)
                        self.assertGreater(len(response.data), 2500)

    def test_report_period_parser_returns_month_and_year_date_ranges(self):
        with backend.app.test_request_context("/api/reports/pending.pdf?period=month&year=2026&month=12"):
            month = backend.report_period_from_request()
        self.assertEqual(month, {
            "start": date(2026, 12, 1), "end": date(2027, 1, 1), "key": "2026-12",
        })
        self.assertEqual(backend.report_period_label(month), "diciembre 2026")

        with backend.app.test_request_context("/api/reports/pending.pdf?period=year&year=2026"):
            year = backend.report_period_from_request()
        self.assertEqual(year, {
            "start": date(2026, 1, 1), "end": date(2027, 1, 1), "key": "2026",
        })
        self.assertEqual(backend.report_period_label(year), "2026")

    def test_report_period_parser_rejects_invalid_period_parameters(self):
        for query in (
            "period=month&year=2026",
            "period=month&year=2026&month=13",
            "period=year&year=2026&month=1",
            "period=week&year=2026",
        ):
            with self.subTest(query=query), backend.app.test_request_context(
                "/api/reports/pending.pdf?" + query
            ):
                with self.assertRaises(BadRequest):
                    backend.report_period_from_request()

    def test_list_report_period_filters_detection_or_closure_date(self):
        period = {"start": date(2026, 10, 1), "end": date(2026, 11, 1)}
        statements = []

        def capture_rows(sql, *params):
            statements.append((sql, params))
            return []

        with patch.object(backend, "rows", side_effect=capture_rows):
            backend.report_findings_by_status("pendiente", period)
            backend.report_findings_by_status("solucionado", period)

        self.assertIn("f.inspected_at >= %s AND f.inspected_at < %s", statements[0][0])
        self.assertEqual(statements[0][1], ("pendiente", period["start"], period["end"], 500, 0))
        self.assertIn("f.closed_at >= %s AND f.closed_at < %s", statements[1][0])
        self.assertEqual(statements[1][1], ("solucionado", period["start"], period["end"], 500, 0))

    def test_executive_report_period_filters_all_kpi_queries(self):
        period = {"start": date(2026, 1, 1), "end": date(2027, 1, 1)}
        one_queries, row_queries = [], []

        def capture_one(sql, *params):
            one_queries.append((sql, params))
            return {"total": 0, "pending": 0, "solved": 0, "overdue": 0}

        def capture_rows(sql, *params):
            row_queries.append((sql, params))
            return []

        with patch.object(backend, "one", side_effect=capture_one), \
             patch.object(backend, "rows", side_effect=capture_rows):
            backend.report_kpi_data(period)

        self.assertIn("WHERE inspected_at >= %s AND inspected_at < %s", one_queries[0][0])
        self.assertEqual(one_queries[0][1], (period["start"], period["end"]))
        self.assertIn("f.inspected_at >= %s AND f.inspected_at < %s", row_queries[0][0])
        self.assertIn("inspected_at >= %s AND inspected_at < %s", row_queries[1][0])
        self.assertTrue(all(params == (period["start"], period["end"]) for _, params in row_queries))

    def test_report_endpoint_accepts_period_and_rejects_invalid_range(self):
        with patch.object(backend, "db", return_value=ReadOnlyDatabase()), \
             patch.object(backend, "rows", return_value=[]):
            response = self.client_for("supervisor").get(
                "/api/reports/pending.pdf?period=month&year=2026&month=10"
            )
            invalid = self.client_for("supervisor").get(
                "/api/reports/pending.pdf?period=month&year=2026&month=15"
            )
        self.assert_pdf_response(response)
        self.assertIn("hallazgos-pendientes-2026-10.pdf", response.headers["Content-Disposition"])
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.get_json()["error"], "El mes del período no es válido.")

    def test_database_errors_log_diagnostics_without_exposing_them_to_clients(self):
        failure = backend.psycopg.errors.UndefinedColumn("missing report column")
        with patch.object(backend, "db", return_value=ReadOnlyDatabase()), \
             patch.object(backend, "one", side_effect=failure), \
             self.assertLogs(backend.app.logger.name, level="ERROR") as captured:
            response = self.client_for("supervisor").get("/api/reports/executive.pdf")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "No se pudo completar la operación en la base de datos. Probá de nuevo.")
        self.assertIn("SQLSTATE=42703", captured.output[0])
        self.assertIn("ruta=/api/reports/executive.pdf", captured.output[0])

    def test_security_assessment_uses_explicit_data_and_history(self):
        critical = backend.security_assessment(
            2, {"alta": 1, "media": 1, "baja": 0}, 0, 1, 4, True, "improving", -2,
        )
        self.assertEqual(critical["state"], "critical")
        self.assertEqual(critical["attentionCount"], 2)

        overdue = backend.security_assessment(
            1, {"alta": 0, "media": 0, "baja": 1}, 1, 0, 4, True, "improving", -1,
        )
        self.assertEqual(overdue["state"], "critical")

        attention = backend.security_assessment(
            1, {"alta": 0, "media": 0, "baja": 1}, 0, 0, 2, True, "stable", 0,
        )
        self.assertEqual(attention["state"], "attention")

        no_data = backend.security_assessment(
            0, {"alta": 0, "media": 0, "baja": 0}, 0, 0, 0, False, "insufficient", None,
        )
        self.assertEqual(no_data["state"], "attention")
        self.assertIn("ausencia de registros", no_data["message"])

        controlled = backend.security_assessment(
            0, {"alta": 0, "media": 0, "baja": 0}, 0, 0, 3, True, "stable", 0,
        )
        self.assertEqual(controlled["state"], "controlled")

    def test_dashboard_returns_realistic_security_metrics_and_trend(self):
        def fake_dashboard_rows(sql, *params):
            if "SELECT criticality k" in sql:
                return [{"k": "alta", "n": 1}, {"k": "media", "n": 1}, {"k": "baja", "n": 1}]
            if "SELECT location_id, COUNT(*) n" in sql:
                return [{"location_id": 1, "n": 3}]
            if "SELECT id, name FROM locations" in sql:
                return [{"id": 1, "name": "Polímeros"}]
            if "SELECT id, tag, zone, criticality" in sql:
                return []
            raise AssertionError("Consulta inesperada del dashboard")

        def fake_dashboard_one(sql, *params):
            if "aged_15_30" in sql:
                self.assertIn("BETWEEN 15 AND 30", sql)
                return {"overdue": 1, "aged_15_30": 2}
            if "first_inspection" in sql:
                return {
                    "first_inspection": date.today() - timedelta(days=90),
                    "opened_current": 3, "opened_previous": 1,
                    "closed_current": 1, "closed_previous": 2,
                }
            if "average_days" in sql:
                return {"total": 8, "pending": 3, "solved": 5, "average_days": 4.5}
            raise AssertionError("Resumen inesperado del dashboard")

        with patch.object(backend, "db", return_value=ReadOnlyDatabase()), \
             patch.object(backend, "rows", side_effect=fake_dashboard_rows), \
             patch.object(backend, "one", side_effect=fake_dashboard_one):
            response = self.client_for("tecnico").get("/api/dashboard")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["pending"], 3)
        self.assertEqual(data["overdue"], 1)
        self.assertEqual(data["aged15to30"], 2)
        self.assertEqual(data["resolutionRate"], 62.5)
        self.assertEqual(data["averageResolutionDays"], 4.5)
        self.assertEqual(data["trend"], {
            "available": True, "direction": "worsening", "currentNet": 2, "previousNet": -1,
        })
        self.assertEqual(data["security"]["state"], "critical")

    def test_findings_overdue_filter_is_pending_and_strictly_over_30_days(self):
        statements = []

        def capture_rows(sql, *params):
            statements.append(sql)
            return []

        with backend.app.test_request_context("/api/findings?status=pendiente&overdue=1"), \
             patch.object(backend, "rows", side_effect=capture_rows):
            backend.findings()
        query = statements[0]
        self.assertIn("f.status='pendiente' AND CURRENT_DATE - f.inspected_at > 30", query)
        self.assertIn("f.status=%s", query)

    def test_pdf_charts_receive_nonempty_report_data(self):
        status = backend.report_status_chart(3, 2).contents[0]
        self.assertEqual(status.data, [[3, 0], [0, 2]])

        criticality = backend.report_criticality_chart(["Alta", "Media"], [2, 1]).contents[0]
        self.assertEqual(criticality.data, [2, 1])

        areas = backend.report_area_chart([{"area": "Polímeros", "count": 3}]).contents[0]
        self.assertEqual(areas.data, [[3]])

        self.assertIsNone(backend.report_month_chart([("2026-10", 0)]))

    def test_executive_pdf_uses_reference_layout_and_dynamic_values(self):
        queries = []
        summary_queries = []

        def capture_rows(sql, *params):
            queries.append(sql)
            return self.fake_rows(sql, *params)

        def capture_one(sql, *params):
            summary_queries.append(sql)
            return self.fake_one(sql, *params)

        with patch.object(backend, "db", return_value=ReadOnlyDatabase()), \
             patch.object(backend, "one", side_effect=capture_one), \
             patch.object(backend, "rows", side_effect=capture_rows):
            response = self.client_for("supervisor").get("/api/reports/executive.pdf")
        self.assert_pdf_response(response)
        self.assertEqual(len(re.findall(rb"/Type\s*/Page\b", response.data)), 1)
        summary_query = summary_queries[0]
        area_query = next(sql for sql in queries if "GROUP BY l.name" in sql)
        criticality_query = next(sql for sql in queries if "GROUP BY criticality" in sql)
        self.assertIn("CURRENT_DATE - inspected_at > 30", summary_query)
        self.assertTrue(summary_query.rstrip().endswith("FROM findings"))
        self.assertIn("FILTER (WHERE f.status='pendiente')", area_query)
        self.assertIn("FILTER (WHERE f.status='solucionado')", area_query)
        self.assertIn("WHERE status='pendiente'", criticality_query)
        story = backend.executive_report_content((
            self.fake_one("SELECT total FROM findings"),
            self.fake_rows("GROUP BY l.name"),
            self.fake_rows("GROUP BY criticality"),
        ))
        text = self.report_story_text(story)
        self.assertIn("INDICADORES CLAVE DE GESTIÓN", text)
        self.assertIn("TOTAL HALLAZGOS", text)
        self.assertIn("SOLUCIONADOS", text)
        self.assertIn("2 (66.7%)", text)
        self.assertIn("DISTRIBUCIÓN POR ÁREA Y ESTADO", text)
        self.assertIn("Extrusión", text)
        self.assertIn("Hay 1 hallazgo pendiente", text)
        self.assertIn("no constituye evidencia", text)

    def test_findings_list_includes_zero_one_and_multiple_photo_ids(self):
        record = {
            "id": 41, "tag": "HAZ-041", "equipment_id": None, "location_id": 1, "zone": "1",
            "protection": None, "criticality": "media", "status": "pendiente", "finding_type": "Deterioro",
            "equipment_type": "Instrumento", "equipment_location": "Nave 2",
            "description": "Descripción", "ot": None, "inspected_at": date.today(),
            "inspector": "Inspector", "closer": None, "closed_at": None, "resolution": None,
        }
        photo_rows = [
            {"finding_id": 41, "id": 7},
            {"finding_id": 41, "id": 8},
            {"finding_id": 41, "id": 9},
        ]

        def fake_list_rows(sql, *params):
            if "FROM locations" in sql:
                return [{"id": 1, "name": "Polímeros"}]
            if "WHERE finding_id=ANY" in sql:
                return photo_rows
            return [record]

        with patch.object(backend, "db", return_value=ReadOnlyDatabase()), patch.object(backend, "rows", side_effect=fake_list_rows):
            response = self.client_for("tecnico").get("/api/findings")
        self.assertEqual(response.status_code, 200)
        item = response.get_json()["items"][0]
        self.assertEqual(item["photoIds"], [7, 8, 9])
        self.assertEqual(item["equipmentType"], "Instrumento")
        self.assertEqual(item["equipmentLocation"], "Nave 2")
        self.assertNotIn("data", item)

        photo_rows.clear()
        with patch.object(backend, "db", return_value=ReadOnlyDatabase()), patch.object(backend, "rows", side_effect=fake_list_rows):
            response = self.client_for("tecnico").get("/api/findings")
        self.assertEqual(response.get_json()["items"][0]["photoIds"], [])

        photo_rows.append({"finding_id": 41, "id": 10})
        with patch.object(backend, "db", return_value=ReadOnlyDatabase()), patch.object(backend, "rows", side_effect=fake_list_rows):
            response = self.client_for("tecnico").get("/api/findings")
        self.assertEqual(response.get_json()["items"][0]["photoIds"], [10])


if __name__ == "__main__":
    unittest.main()