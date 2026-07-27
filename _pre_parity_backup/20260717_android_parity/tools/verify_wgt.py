#!/usr/bin/env python3
"""
verify_wgt.py — audit a Tizen .wgt before you publish it.

Fails (exit 1) if the package contains code-signing material, nested packages,
or dev leftovers. Run this on every build, and on anything already published.

    python tools/verify_wgt.py .buildResult/VYPA_TEP.wgt

Why this exists
---------------
VYPA2.wgt shipped author.p12 (the PKCS#12 signing key) and author.pwd inside
the package, and that package is served unauthenticated from packages.vypa.co.
Anyone who fetched the URL got the signing key. This script makes that class of
mistake loud instead of silent.
"""

import sys
import zipfile

# (pattern, why it must not ship)
FATAL = [
    (".p12",        "PKCS#12 code-signing private key"),
    (".pfx",        "PKCS#12 code-signing private key"),
    ("author.pwd",  "signing key password"),
    ("distributor.pwd", "distributor key password"),
    (".pem",        "private key / certificate material"),
    (".key",        "private key material"),
    (".wgt",        "nested package (bloats the build; may itself contain keys)"),
]

WARN = [
    ("_pre_parity_backup/", "dead backup source"),
    (".project",   "IDE metadata"),
    (".tproject",  "IDE metadata"),
    (".settings/", "IDE metadata"),
    ("tools/",     "dev-only tooling"),
    ("README.md",  "dev-only docs"),
    (".git",       "version control metadata"),
]


def audit(path):
    try:
        z = zipfile.ZipFile(path)
    except Exception as e:
        print(f"ERROR: cannot read {path}: {e}")
        return 1

    names = z.namelist()
    total = sum(z.getinfo(n).file_size for n in names)
    print(f"Package : {path}")
    print(f"Entries : {len(names)}")
    print(f"Uncompressed: {total / 1024 / 1024:.1f} MB")
    print()

    fatal_hits, warn_hits = [], []
    for n in names:
        low = n.lower()
        for pat, why in FATAL:
            if low.endswith(pat) or low.split("/")[-1] == pat:
                fatal_hits.append((n, why, z.getinfo(n).file_size))
        for pat, why in WARN:
            if pat.lower() in low:
                warn_hits.append((n, why))

    if fatal_hits:
        print("FATAL — must not be in a published package:")
        for n, why, size in fatal_hits:
            print(f"  !! {n}  ({size:,} bytes) — {why}")
        print()

    if warn_hits:
        print("WARN — dev leftovers, safe but should be excluded:")
        seen = set()
        for n, why in warn_hits:
            if why in seen:
                continue
            seen.add(why)
            same = sum(1 for m, w in warn_hits if w == why)
            print(f"   - {why}: {same} entr{'y' if same == 1 else 'ies'} (e.g. {n})")
        print()

    if fatal_hits:
        print("RESULT: FAIL — do not publish this package.")
        return 1

    print("RESULT: PASS — no key material or nested packages.")
    if warn_hits:
        print("        (warnings above are non-blocking)")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(audit(sys.argv[1]))
