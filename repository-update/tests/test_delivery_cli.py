"""Exercise the installed AWS CLI against loopback HTTP, without AWS credentials.

These tests are required on GitHub runners. Local machines without AWS CLI v2
skip them; the remaining delivery tests still run with the standard library.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.parse import unquote, urlsplit

from scripts.delivery_common import Aws, DeliveryError


class _ObjectHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        self.server.requests.append((path, dict(self.headers)))
        if path in self.server.objects:
            status, body = 200, self.server.objects[path]
            content_type = "application/octet-stream"
        else:
            status = 404
            body = b"<Error><Code>NoSuchKey</Code><Message>Fixture object missing</Message></Error>"
            content_type = "application/xml"
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class _LoopbackAws(Aws):
    def __init__(self, endpoint):
        super().__init__("us-east-2")
        self.endpoint = endpoint

    def call(self, service, operation, payload=None, extra=()):
        if (service, operation) != ("s3api", "get-object"):
            raise AssertionError("The CLI fixture only accepts S3 downloads.")
        return super().call(service, operation, payload, [*extra,
            "--endpoint-url", self.endpoint, "--no-sign-request",
            "--no-cli-auto-prompt", "--cli-connect-timeout", "2", "--cli-read-timeout", "3"])


class DeliveryCliTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        executable = shutil.which("aws")
        available = False
        if executable:
            result = subprocess.run([executable, "--version"], capture_output=True, text=True, timeout=15)
            available = result.returncode == 0 and "aws-cli/2." in result.stdout + result.stderr
        if not available:
            message = "AWS CLI v2 is required for the loopback S3 transport tests."
            if os.environ.get("GITHUB_ACTIONS") == "true":
                raise AssertionError(message)
            raise unittest.SkipTest(message + " Install it locally or run CI on GitHub.")

    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="karaoke-cli-test-")
        self.addCleanup(directory.cleanup)
        isolated = {key: value for key, value in os.environ.items() if not key.startswith("AWS_")}
        isolated.update({
            "AWS_CONFIG_FILE": str(Path(directory.name) / "no-config"),
            "AWS_SHARED_CREDENTIALS_FILE": str(Path(directory.name) / "no-credentials"),
            "AWS_EC2_METADATA_DISABLED": "true",
            "AWS_MAX_ATTEMPTS": "1",
            "AWS_CLI_AUTO_PROMPT": "off",
            "NO_PROXY": "127.0.0.1,localhost",
            "no_proxy": "127.0.0.1,localhost",
        })
        environment = patch.dict(os.environ, isolated, clear=True)
        environment.start()
        self.addCleanup(environment.stop)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _ObjectHandler)
        self.server.objects, self.server.requests = {}, []
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.aws = _LoopbackAws(f"http://127.0.0.1:{self.server.server_port}")

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)

    def assert_unsigned_request(self, expected_path):
        self.assertEqual(len(self.server.requests), 1)
        path, headers = self.server.requests[0]
        self.assertEqual(path, expected_path)
        self.assertNotIn("authorization", {key.lower() for key in headers})

    def test_real_cli_downloads_exact_bytes_with_literal_key(self):
        key = "site/literal $(text) `text` + #.html"
        body = b"\x00\xff\r\nfixture bytes\n"
        path = "/example-site/" + key
        self.server.objects[path] = body
        self.assertEqual(self.aws.get_blob("example-site", key), body)
        self.assert_unsigned_request(path)

    def test_real_cli_surfaces_s3_failure(self):
        with self.assertRaises(DeliveryError) as error:
            self.aws.get_blob("example-site", "missing.html")
        self.assertTrue(str(error.exception).startswith("AWS s3api get-object failed:"))
        self.assertIn("NoSuchKey", str(error.exception))
        self.assert_unsigned_request("/example-site/missing.html")


if __name__ == "__main__":
    unittest.main()
