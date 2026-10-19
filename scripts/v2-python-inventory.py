"""Print the installed development inventory; no environment values or keys."""
from hashlib import sha256
from importlib.metadata import distributions
import json

components = []
for dist in distributions():
    metadata = dist.metadata
    if metadata["Name"].lower() in ("pip", "setuptools"):
        continue
    license_text = metadata.get("License-Expression") or metadata.get("License")
    if not license_text:
        license_text = "; ".join(value for value in metadata.get_all("Classifier", []) if value.startswith("License ::")) or "REVIEW_REQUIRED"
    components.append({"name": metadata["Name"], "version": dist.version, "licenseDeclared": license_text,
                       "metadataSha256": sha256(dist.read_text("METADATA").encode()).hexdigest()})
print(json.dumps({"format": "LeapSign dependency inventory 1", "scope": "v2 isolated development environment; includes test dependencies",
                  "components": sorted(components, key=lambda item: item["name"].lower())}, indent=2))
