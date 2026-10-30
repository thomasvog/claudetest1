import io
import unittest
from contextlib import nullcontext
from datetime import date, timedelta
from unittest.mock import patch

from PIL import Image

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


def finding(status="solucionado", finding_id=41):
    today = date.today()
    return {
        "id": finding_id,
        "tag": "HAZ-041",
        "status": status,
        "criticality": "alta",
        "inspected_at": today - timedelta(days=8),
        "closed_at": today - timedelta(days=3) if status == "solucionado" else None,
        "area": "Extrusión",
        "description": "Descripción <segura> del hallazgo",
        "resolution": "Se sustituyó el componente",
        "closer": "Responsable de cierre",
        "inspector": "Inspector de prueba",
        "ot": "OT-41",
    }


def image_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (20, 80, 60)).save(buf, format="JPEG")
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
        if role:
            with client.session_transaction() as sess:
                sess["uid"] = 1
                sess["role"] = role
                sess["name"] = "Usuario de prueba"
        return client

    def fake_rows(self, sql, *params):
        if "FROM photos" in sql:
            return [{"id": 9, "kind": "despues", "data": image_bytes()}]
        if "WHERE f.status=%s" in sql:
            status, _, offset = params
            return [finding(status)] if offset == 0 else []
        if "GROUP BY criticality" in sql:
            return [
                {"criticality": "alta", "count": 1},
                {"criticality": "media", "count": 1},
                {"criticality": "baja", "count": 1},
            ]
        if "GROUP BY l.name" in sql:
            return [{"area": "Extrusión", "count": 2}, {"area": "Servicios", "count": 1}]
        if "date_trunc('month'" in sql:
            return [
                {"month": date.today().strftime("%Y-%m"), "count": 2},
                {"month": (date.today().replace(day=1) - timedelta(days=1)).strftime("%Y-%m"), "count": 1},
            ]
        return []

    def fake_one(self, sql, *params):
        if "WHERE f.id=%s" in sql:
            return finding("solucionado", params[0])
        return {"total": 3, "pending": 1, "solved": 2, "overdue": 1, "average_days": 5.0}

    def test_individual_pdf_is_available_to_each_authenticated_role(self):
        with patch.object(backend, "db", return_value=ReadOnlyDatabase()), \
             patch.object(backend, "one", side_effect=self.fake_one), \
             patch.object(backend, "rows", side_effect=self.fake_rows):
            for role in ("tecnico", "supervisor", "admin"):
                with self.subTest(role=role):
                    response = self.client_for(role).get("/api/reports/findings/41.pdf")
                    self.assertEqual(response.status_code, 200)
                    self.assertTrue(response.data.startswith(b"%PDF-"))
                    self.assertIn("hallazgo-41-solucionado.pdf", response.headers["Content-Disposition"])
                    self.assertEqual(response.headers["Cache-Control"], "private, no-store")

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
                        self.assertEqual(response.status_code, 200)
                        self.assertTrue(response.data.startswith(b"%PDF-"))


if __name__ == "__main__":
    unittest.main()