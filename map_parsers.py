"""Per-brand map parser dispatch (construction, key derivation, unpack kwargs).

See docs/dev/map-pipeline.md for the per-brand map pipeline details.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import zlib
from typing import Any

_LOGGER = logging.getLogger(__name__)

SUPPORTED_BRANDS = ("ijai", "xiaomi", "dreame", "viomi", "roidmi")


def dreame_extract_enckey(prop_value: str) -> str | None:
    """Extract the enckey from MIoT property siid=6/piid=3 value `<object_path>,<enckey>`.

    Returns None when the value contains no comma (unencrypted dreame model).
    Verified against Tasshack's dreame-vacuum 2026-07-03.
    """
    if not prop_value or "," not in prop_value:
        return None
    parts = prop_value.split(",")
    # `or None`: an empty key ("path,") means no usable enckey.
    return (parts[1] or None) if len(parts) > 1 else None


def dreame_decrypt_cloud_blob(raw: bytes, enckey: str) -> bytes:
    """Decrypt and decompress a dreame cloud map blob.

    Implements the Tasshack-verified decode chain (dreame/map.py ~L1883-1907):
      1. URL-safe base64 normalise (replace _ and -)
      2. base64 decode
      3. AES-256-CBC: key = SHA256(enckey)[:32], IV = 16 zero bytes
      4. zlib decompress

    Returns decompressed map bytes ready for parser.parse(). Call directly
    instead of parser.unpack_map() for models not in the parser's built-in
    IVs dict (those use a zero IV, not a model-specific IV).
    """
    try:
        from Crypto.Cipher import AES
    except ModuleNotFoundError:  # pragma: no cover
        from Cryptodome.Cipher import AES

    raw_str = raw.decode().replace("_", "/").replace("-", "+")
    raw_bytes = base64.decodebytes(raw_str.encode("utf8"))
    key = hashlib.sha256(enckey.encode()).hexdigest()[:32].encode("utf8")
    decrypted = AES.new(key, AES.MODE_CBC, iv=b"\x00" * 16).decrypt(raw_bytes)
    return zlib.decompress(decrypted)


# New-generation xiaomi profiles whose cloud map is the JSON format that
# vacuum-map-parser-xiaomi handles. Confirmed models per the upstream README
# (github.com/PiotrMachowski/Python-package-vacuum-map-parser-xiaomi, verified
# 2026-07-03): e101gb, ov31gl, ov71gl, ov81gl. ov21gl is absent from both
# parser READMEs; assumed xiaomi-JSON by family resemblance — route to ijai
# only if hardware testing contradicts this. Every other xiaomi.* profile is
# an ijai-engine rebrand (RobotMap protobuf: c103/c104/b106eu etc.).
_XIAOMI_JSON_MAP_PROFILES = frozenset({
    "xiaomi.e101gb",
    "xiaomi.ov21gl",
    "xiaomi.ov31gl",
    "xiaomi.ov71gl",
    "xiaomi.ov81gl",
})


def ijai_decrypt_try_variants(
    raw: bytes, *, wifi_sn: str, owner_id: str, device_id: str, model: str, device_mac: str,
) -> bytes:
    """Decrypt + decompress an ijai-family map blob, trying BOTH key-type
    variants instead of trusting vacuum_map_parser_ijai's hardcoded per-model
    whitelist (`is_EncryptKeyTypeHex_model`).

    That whitelist is keyed on exact model strings the library's author has
    seen; a model that's spec-identical to a whitelisted one for CONTROL
    purposes (our own registry aliasing) isn't guaranteed to match it for
    encryption purposes too — the two are independent facts about the
    firmware. Rather than assume, derive the key both ways and use whichever
    actually produces a valid zlib stream.

    Raises the hex-variant's exception if neither variant unpacks (keeps
    the caller's existing "Could not decrypt" handling working unchanged).
    """
    try:
        from Crypto.Cipher import AES
        from Crypto.Hash import MD5
        from Crypto.Util.Padding import pad, unpad
    except ModuleNotFoundError:  # pragma: no cover
        from Cryptodome.Cipher import AES
        from Cryptodome.Hash import MD5
        from Cryptodome.Util.Padding import pad, unpad

    try:
        data = base64.b64decode(raw, validate=True)
    except Exception:  # noqa: BLE001
        data = raw

    # Before spending effort trying key variants: AES-ECB requires the
    # ciphertext to be an exact multiple of the block size. If it isn't,
    # this blob was never a valid encrypted map to begin with — no key
    # will ever decrypt it, and repeated identical "Padding is incorrect"
    # errors across every key variant are consistent with a truncated/
    # corrupted upload rather than a wrong-key problem.
    if len(data) == 0 or len(data) % 16 != 0:
        _LOGGER.debug(
            "ijai map blob is not AES-block-aligned: %d bytes (raw len %d) — "
            "this can't be decrypted with any key; likely a truncated/failed "
            "upload rather than a wrong-key issue",
            len(data), len(raw),
        )
    else:
        _LOGGER.debug("ijai map blob: %d bytes, block-aligned, attempting decrypt", len(data))

    def _aes_encrypt(s: str, key: str) -> str:
        cipher = AES.new(key.encode("utf-8"), AES.MODE_ECB)
        encrypted = cipher.encrypt(pad(s.encode("utf-8"), AES.block_size))
        return base64.b64encode(encrypted).decode("utf-8")

    def _md5key(string: str, is_hex: bool) -> str:
        pjstr = "".join(device_mac.lower().split(":"))
        temp_model = model.split(".")[-1]
        if len(temp_model) == 2:
            temp_model = "00" + temp_model
        elif len(temp_model) == 3:
            temp_model = "0" + temp_model
        elif len(temp_model) > 4:
            temp_model = temp_model[-4:]
        aeskey = _aes_encrypt(string, pjstr + temp_model)
        digest = MD5.new(aeskey.encode("utf-8")).hexdigest()
        return digest if is_hex else digest[8:-8].upper()

    joined = "+".join([wifi_sn, owner_id, device_id])

    last_err: Exception | None = None
    for is_hex in (True, False):
        try:
            key_str = _md5key(joined, is_hex)
            parsed_key = bytes.fromhex(key_str) if is_hex else key_str.encode("utf-8")
            cipher = AES.new(parsed_key, AES.MODE_ECB)
            decrypted = unpad(cipher.decrypt(data), AES.block_size, "pkcs7")
            hex_bytes = bytes.fromhex(decrypted.decode("utf-8"))
            result = zlib.decompress(hex_bytes)
            _LOGGER.debug("ijai map decrypt: key-type-hex=%s worked", is_hex)
            return result
        except Exception as err:  # noqa: BLE001
            last_err = err
            continue
    raise last_err  # both variants failed; surface the last error as before


def map_url_endpoint(key: str) -> str:
    """Cloud endpoint path segment for fetching a map blob.

    ijai is the only confirmed _pro user (ijai.v17 hardware-verified; Tasshack
    uses _pro when device v3 flag is True). All other brands use the plain
    variant, per PiotrMachowski's extractor (verified 2026-07-03).
    Connector falls back to the other variant on a code -8 response.
    """
    return "get_interim_file_url_pro" if key == "ijai" else "get_interim_file_url"


def parser_key(profile) -> str:
    """Which parser family decodes ``profile``'s cloud map blob.

    Untyped (duck-types `.brand`/`.profile_id`) so tests/pure can import this
    module standalone without pulling in `spec.types.ModelProfile`.
    """
    if profile.brand == "xiaomi":
        return "xiaomi" if profile.profile_id in _XIAOMI_JSON_MAP_PROFILES else "ijai"
    return profile.brand


def has_ijai_grid(brand: str) -> bool:
    """True only for ijai: its unpacked blob is the `RobotMap` protobuf the
    crisp labelled-grid extractor (`map_vector.extract_grid`) reads."""
    return brand == "ijai"


def make_parser(brand: str, model: str, palette, sizes, drawables, image_config, texts):
    """Construct the parser for ``brand`` (lazy import). Raises ValueError for an
    unknown brand, ImportError if the brand's dep isn't installed."""
    if brand == "ijai":
        from vacuum_map_parser_ijai.map_data_parser import IjaiMapDataParser
        return IjaiMapDataParser(palette, sizes, drawables, image_config, texts)
    if brand == "xiaomi":
        from vacuum_map_parser_xiaomi.map_data_parser import XiaomiMapDataParser
        return XiaomiMapDataParser(palette, sizes, drawables, image_config, texts)
    if brand == "dreame":
        from vacuum_map_parser_dreame.map_data_parser import DreameMapDataParser
        # dreame needs the model to select its per-model decryption IV.
        return DreameMapDataParser(palette, sizes, drawables, image_config, texts, model)
    if brand == "viomi":
        from vacuum_map_parser_viomi.map_data_parser import ViomiMapDataParser
        return ViomiMapDataParser(palette, sizes, drawables, image_config, texts)
    if brand == "roidmi":
        from vacuum_map_parser_roidmi.map_data_parser import RoidmiMapDataParser
        return RoidmiMapDataParser(palette, sizes, drawables, image_config, texts)
    raise ValueError(f"no map parser for brand {brand!r}")


def required_map_key_inputs(brand: str) -> frozenset[str]:
    """Keys that MUST be non-empty before a MapFetcher can be constructed.

    ijai   : wifi_sn + device_mac (both feed the AES-ECB key derivation)
    xiaomi : model + device_id   (AES-CBC IV derivation; both always present)
    dreame : none required        (enckey is polled from the cloud at fetch time,
                                   not from the device; plain zlib fallback for
                                   unencrypted models when no enckey is found)
    viomi  : none                 (plain zlib; no local key material needed)
    roidmi : none                 (gzip decompress; no key material needed)
    """
    if brand == "ijai":
        return frozenset({"wifi_sn", "device_mac"})
    if brand in ("xiaomi", "dreame", "viomi", "roidmi"):
        return frozenset()
    raise ValueError(f"no map parser for brand {brand!r}")


def unpack_kwargs(
    brand: str,
    *,
    wifi_sn: str,
    owner_id: str,
    device_id: str,
    model: str,
    device_mac: str,
    enckey: str | None = None,
) -> dict[str, Any]:
    """Keyword args for ``parser.unpack_map`` for this brand (see module docstring
    for the per-brand key derivation each set feeds)."""
    if brand == "ijai":
        return {
            "wifi_sn": wifi_sn,
            "owner_id": owner_id,
            "device_id": device_id,
            "model": model,
            "device_mac": device_mac,
        }
    if brand == "xiaomi":
        return {"model": model, "device_id": device_id}
    if brand == "dreame":
        # enckey from siid=6/piid=3 cloud property; None for unencrypted models.
        # Only passed to parser.unpack_map for models in its built-in IVs dict.
        # Zero-IV models are decrypted by dreame_decrypt_cloud_blob before parse.
        return {"enckey": enckey} if enckey is not None else {}
    if brand in ("viomi", "roidmi"):
        return {}
    raise ValueError(f"no map parser for brand {brand!r}")