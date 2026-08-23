import textwrap

from hermes_cli.config import load_config, save_config


def _write_config(tmp_path, body: str):
    (tmp_path / "config.yaml").write_text(textwrap.dedent(body), encoding="utf-8")


def _read_config(tmp_path) -> str:
    return (tmp_path / "config.yaml").read_text(encoding="utf-8")




def test_load_config_resolves_active_profile_dotenv_and_detects_rotation(monkeypatch, tmp_path):
    """Early config loads must resolve the active profile .env without a global export.

    The config file stays byte-identical while the dotenv value rotates, so this
    also pins cache invalidation against profile-local env refs.
    """
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.delenv("A2A_PEER_GAMING_4090", raising=False)
    _write_config(
        tmp_path,
        """\
        a2a_agents:
          gaming-4090:
            url: ${env:A2A_PEER_GAMING_4090}
        """,
    )
    env_path = tmp_path / ".env"
    env_path.write_text("A2A_PEER_GAMING_4090=http://127.0.0.1:9900\n", encoding="utf-8")

    first = load_config()
    assert first["a2a_agents"]["gaming-4090"]["url"] == "http://127.0.0.1:9900"

    env_path.write_text("A2A_PEER_GAMING_4090=http://127.0.0.1:9901\n", encoding="utf-8")
    second = load_config()
    assert second["a2a_agents"]["gaming-4090"]["url"] == "http://127.0.0.1:9901"


def test_save_config_preserves_unresolved_env_refs(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.delenv("MISSING_SECRET", raising=False)
    _write_config(
        tmp_path,
        """\
        custom_providers:
          - name: unresolved
            api_key: ${MISSING_SECRET}
            model: claude-opus-4-6
        model:
          default: claude-opus-4-6
        """,
    )

    config = load_config()
    config["display"]["compact"] = True
    save_config(config)

    assert "api_key: ${MISSING_SECRET}" in _read_config(tmp_path)


def test_save_config_allows_intentional_secret_value_change(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("TU_ZI_API_KEY", "sk-old-secret")
    _write_config(
        tmp_path,
        """\
        custom_providers:
          - name: tuzi
            api_key: ${TU_ZI_API_KEY}
            model: claude-opus-4-6
        model:
          default: claude-opus-4-6
        """,
    )

    config = load_config()
    config["custom_providers"][0]["api_key"] = "sk-new-secret"
    save_config(config)

    saved = _read_config(tmp_path)
    assert "api_key: sk-new-secret" in saved
    assert "${TU_ZI_API_KEY}" not in saved






