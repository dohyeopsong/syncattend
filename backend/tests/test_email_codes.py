from types import SimpleNamespace

from app.services import email_codes


class _FakeSmtp:
    instances: list["_FakeSmtp"] = []

    def __init__(self, host, port, timeout):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.started_tls = False
        self.logged_in = False
        self.sent = False
        self.__class__.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def ehlo(self):
        pass

    def starttls(self):
        self.started_tls = True

    def login(self, _user, _password):
        self.logged_in = True

    def sendmail(self, _sender, _recipient, _message):
        self.sent = True


def _settings(port: int):
    return SimpleNamespace(
        smtp_host="smtp.example.test",
        smtp_port=port,
        smtp_user="sender@example.test",
        smtp_password="password",
    )


def test_smtp_port_587_uses_starttls(monkeypatch):
    _FakeSmtp.instances.clear()
    monkeypatch.setattr(email_codes, "get_settings", lambda: _settings(587))
    monkeypatch.setattr("smtplib.SMTP", _FakeSmtp)

    email_codes._send_via_smtp("student@example.test", "subject", "body")

    server = _FakeSmtp.instances[-1]
    assert server.started_tls is True
    assert server.logged_in is True
    assert server.sent is True


def test_smtp_port_465_uses_implicit_tls(monkeypatch):
    _FakeSmtp.instances.clear()
    monkeypatch.setattr(email_codes, "get_settings", lambda: _settings(465))
    monkeypatch.setattr("smtplib.SMTP_SSL", _FakeSmtp)

    email_codes._send_via_smtp("student@example.test", "subject", "body")

    server = _FakeSmtp.instances[-1]
    assert server.started_tls is False
    assert server.logged_in is True
    assert server.sent is True
