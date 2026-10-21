"""Bounded refresh of public CRLs declared by the production trust policy."""
from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
import logging
import os
from pathlib import Path
import tempfile
import threading
import time
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from cryptography import x509
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa


class RevocationFailure(Exception):
    pass


_log = logging.getLogger("leapsign.v2.revocation")
_lock = threading.Lock()
_attempts: dict[str, float] = {}


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _verify(data: bytes, issuer_data: bytes, now: datetime) -> tuple[datetime, datetime]:
    try:
        item = x509.load_der_x509_crl(data)
        issuer = x509.load_der_x509_certificate(issuer_data)
        if item.issuer != issuer.subject:
            raise RevocationFailure("CRL_ISSUER_MISMATCH")
        key = issuer.public_key()
        if isinstance(key, rsa.RSAPublicKey):
            key.verify(item.signature, item.tbs_certlist_bytes, padding.PKCS1v15(), item.signature_hash_algorithm)
        elif isinstance(key, ec.EllipticCurvePublicKey):
            key.verify(item.signature, item.tbs_certlist_bytes, ec.ECDSA(item.signature_hash_algorithm))
        else:
            raise RevocationFailure("CRL_SIGNATURE_UNSUPPORTED")
        this_update, next_update = _utc(item.last_update_utc), item.next_update_utc
        if next_update is None or not this_update <= now <= _utc(next_update):
            raise RevocationFailure("CRL_NOT_CURRENT")
        return this_update, _utc(next_update)
    except RevocationFailure:
        raise
    except Exception:
        raise RevocationFailure("CRL_SIGNATURE_INVALID") from None


def _read(path: Path, maximum: int) -> bytes:
    try:
        if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= maximum:
            raise RevocationFailure("CRL_UNAVAILABLE")
        value = path.read_bytes()
    except OSError:
        raise RevocationFailure("CRL_UNAVAILABLE") from None
    if not 0 < len(value) <= maximum:
        raise RevocationFailure("CRL_UNAVAILABLE")
    return value


def _download(url: str, timeout: int, maximum: int) -> bytes:
    request = Request(url, headers={"Accept": "application/pkix-crl, application/octet-stream", "User-Agent": "LeapSign-v2-CRL/1"})
    with build_opener(_NoRedirect).open(request, timeout=timeout) as response:
        if response.status != 200 or response.geturl() != url:
            raise RevocationFailure("CRL_SOURCE_UNAVAILABLE")
        length = response.headers.get("Content-Length")
        if length and (not length.isascii() or not length.isdigit() or int(length) > maximum):
            raise RevocationFailure("CRL_TOO_LARGE")
        value = response.read(maximum + 1)
    if not 0 < len(value) <= maximum:
        raise RevocationFailure("CRL_TOO_LARGE")
    return value


class RevocationManager:
    def __init__(self, manifest_path: str | Path, *, cache_dir: str | Path | None = None, fetch=None):
        self.manifest_path = Path(manifest_path)
        self.cache_dir = Path(cache_dir or os.getenv("V2_CRL_CACHE_DIR", "/tmp/leapsign-v2-crl"))
        self.fetch = fetch or _download

    def _sources(self):
        try:
            config = json.loads(self.manifest_path.read_bytes())
            base = self.manifest_path.parent
            result = []
            for authority in config["authorities"]:
                hosts = authority["revocationHosts"]
                for entry in authority["revocation"]:
                    refresh = entry.get("refresh")
                    if not refresh:
                        continue
                    url = urlsplit(refresh["url"])
                    if (url.scheme != "https" or url.hostname not in hosts or url.username or url.password
                            or url.query or url.fragment or url.port not in (None, 443)):
                        raise RevocationFailure("CRL_SOURCE_NOT_ALLOWED")
                    maximum = int(refresh["maxBytes"])
                    timeout = int(refresh["timeoutSeconds"])
                    before = int(refresh["refreshBeforeSeconds"])
                    key = refresh["cacheKey"]
                    if not (0 < maximum <= 2_097_152 and 1 <= timeout <= 15 and 300 <= before <= 86_400
                            and isinstance(key, str) and key.replace("-", "").isalnum() and len(key) <= 64):
                        raise RevocationFailure("CRL_REFRESH_POLICY_INVALID")
                    issuer_path = base / refresh["issuerFile"]
                    issuer = _read(issuer_path, 65_536)
                    if sha256(issuer).hexdigest() != entry["issuerSha256"]:
                        raise RevocationFailure("CRL_ISSUER_NOT_PINNED")
                    bundled = _read(base / entry["file"], maximum)
                    if sha256(bundled).hexdigest() != entry["sha256"]:
                        raise RevocationFailure("CRL_BUNDLED_NOT_PINNED")
                    result.append((entry, refresh, issuer, bundled, self.cache_dir / f"{key}.der", maximum, timeout, before))
            return result
        except RevocationFailure:
            raise
        except Exception:
            raise RevocationFailure("CRL_REFRESH_POLICY_INVALID") from None

    def refresh(self, *, force=False):
        now = datetime.now(timezone.utc)
        with _lock:
            sources = self._sources()
            if not sources:
                return {"ready": True, "managed": False}
            summaries = []
            for entry, refresh, issuer, bundled, cache, maximum, timeout, before in sources:
                candidates = []
                for source, path_data in (("bundled-fallback", bundled), ("official-cache", None)):
                    try:
                        data = _read(cache, maximum) if path_data is None else path_data
                        this_update, next_update = _verify(data, issuer, now)
                        candidates.append((next_update, this_update, source, data))
                    except RevocationFailure:
                        pass
                current = max(candidates, default=None)
                due = current is None or (current[0] - now).total_seconds() <= before
                attempted_at = None
                attempt_key = str(self.manifest_path.resolve()) + ":" + refresh["cacheKey"]
                if (force or due) and (force or time.monotonic() - _attempts.get(attempt_key, 0.0) >= 300):
                    attempted_at = now.isoformat()
                    _attempts[attempt_key] = time.monotonic()
                    try:
                        downloaded = self.fetch(refresh["url"], timeout, maximum)
                        if not isinstance(downloaded, bytes) or not 0 < len(downloaded) <= maximum:
                            raise RevocationFailure("CRL_TOO_LARGE")
                        this_update, next_update = _verify(downloaded, issuer, now)
                        if current is None or (next_update, this_update) >= (current[0], current[1]):
                            self.cache_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
                            with tempfile.NamedTemporaryFile(dir=self.cache_dir, delete=False) as handle:
                                handle.write(downloaded)
                                temporary = Path(handle.name)
                            os.chmod(temporary, 0o600)
                            temporary.replace(cache)
                            current = (next_update, this_update, "official-cache", downloaded)
                        _log.info("CRL refresh verified thisUpdate=%s nextUpdate=%s sha256=%s", this_update.isoformat(), next_update.isoformat(), sha256(downloaded).hexdigest())
                    except Exception as error:
                        _log.warning("CRL refresh unavailable code=%s", error.__class__.__name__)
                if current is None:
                    raise RevocationFailure("CRL_NOT_CURRENT")
                summaries.append({"source": current[2], "thisUpdate": current[1].isoformat(),
                                  "nextUpdate": current[0].isoformat(),
                                  "secondsUntilNextUpdate": max(0, int((current[0] - now).total_seconds())),
                                  "lastRefreshAttemptAt": attempted_at})
            closest = min(summaries, key=lambda value: value["secondsUntilNextUpdate"])
            return {"ready": True, "managed": True, **closest}


def cached_crl(manifest_path: str | Path, entry: dict, bundled: bytes) -> bytes:
    """Select the newest valid pinned/cache CRL; used again in the isolated child."""
    refresh = entry.get("refresh")
    if not refresh:
        return bundled
    manager = RevocationManager(manifest_path)
    now = datetime.now(timezone.utc)
    for candidate in manager._sources():
        item, _, issuer, source, cache, maximum, _, _ = candidate
        if item is not entry and item.get("file") != entry.get("file"):
            continue
        valid = []
        cached = None
        if cache.exists():
            try:
                cached = _read(cache, maximum)
            except RevocationFailure:
                pass
        for data in (source, cached):
            if data is None:
                continue
            try:
                times = _verify(data, issuer, now)
                valid.append((times[1], times[0], data))
            except RevocationFailure:
                pass
        if valid:
            return max(valid)[2]
    raise RevocationFailure("CRL_NOT_CURRENT")
