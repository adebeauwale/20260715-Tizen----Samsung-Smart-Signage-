/* =========================================
   VYPA CACHE SERVICE (Tizen)
   - Downloads playlist media to device storage
   - Returns items with localPath set (file:///...)
========================================= */

const CACHE_DIR = "vypa_cache"; // folder name inside documents
const MANIFEST_KEY = "VYPA_CACHED_PLAYLIST_V1";

/* ---------------------------------------------------------
   getPlayableUrl(item, cb) — shared contract with playerEngine.
   On Tizen the filesystem cache already set item.localPath
   (file:///…) during cachePlaylistMedia, so we just hand that
   back (falling through to the remote URL when uncached).
   --------------------------------------------------------- */
function getPlayableUrl(item, cb) {
  cb(item.localPath || item.playUrl || item.url || item.src ||
     item.file || item.media_url || item.path);
}

function isTizen() {
  return typeof tizen !== "undefined" && tizen.filesystem;
}

function getFileExtensionFromUrl(url) {
  try {
    const clean = url.split("?")[0].split("#")[0];
    const parts = clean.split(".");
    if (parts.length < 2) return "";
    return parts.pop().toLowerCase();
  } catch (e) {
    return "";
  }
}

function guessTypeFromExt(ext) {
  if (!ext) return "";
  if (["mp4", "m4v", "mov"].includes(ext)) return "video";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  if (["mp3", "wav", "aac", "m4a"].includes(ext)) return "audio";
  return "";
}

function safeFilename(name) {
  return (name || "")
    .toString()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
}

function buildCacheFilename(item) {
  // Try to build a stable filename so it won’t download again every time
  const url = item.url || item.src || item.file || item.media_url || item.path || "";
  const ext = getFileExtensionFromUrl(url);
  const type = (item.type || item.media_type || guessTypeFromExt(ext) || "media").toLowerCase();
  const id = item.id || item.media_id || item.asset_id || item.uuid || "";
  const baseKey = id || url;  // fallback to URL
  const base = safeFilename(`${type}_${baseKey}`);
  return ext ? `${base}.${ext}` : base;
}

function saveCachedPlaylist(items) {
  try {
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(items));
  } catch (e) {
    console.warn("saveCachedPlaylist failed:", e);
  }
}

function getCachedPlaylist() {
  try {
    const raw = localStorage.getItem(MANIFEST_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function clearCachedPlaylist() {
  try {
    localStorage.removeItem(MANIFEST_KEY);
  } catch (e) {}
}

// ---------- Tizen filesystem helpers ----------

function resolveDocumentsDir(cbOk, cbErr) {
  tizen.filesystem.resolve(
    "documents",
    function (dir) {
      cbOk(dir);
    },
    function (err) {
      cbErr(err);
    },
    "rw"
  );
}

function ensureCacheFolder(docDir, cbOk, cbErr) {
  try {
    // If folder exists, resolve it
    docDir.resolve(
      CACHE_DIR,
      function (existing) {
        cbOk(existing);
      },
      function () {
        // Create folder if not exists
        try {
          const created = docDir.createDirectory(CACHE_DIR);
          cbOk(created);
        } catch (e) {
          cbErr(e);
        }
      }
    );
  } catch (e) {
    cbErr(e);
  }
}

function fileExists(dir, filename, cb) {
  try {
    dir.resolve(
      filename,
      function () { cb(true); },
      function () { cb(false); }
    );
  } catch (e) {
    cb(false);
  }
}

// Download binary via XHR (more reliable on Tizen than fetch for blobs)
function downloadToFile(url, fileObj, cbOk, cbErr) {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.responseType = "arraybuffer";
    xhr.timeout = 120000; // 2 mins per file, adjust if needed

    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = xhr.response;
          fileObj.openStream(
            "w",
            function (stream) {
              try {
                stream.writeBytes(new Uint8Array(data));
                stream.close();
                cbOk();
              } catch (e) {
                try { stream.close(); } catch (_) {}
                cbErr(e);
              }
            },
            function (err) {
              cbErr(err);
            }
          );
        } catch (e) {
          cbErr(e);
        }
      } else {
        cbErr(new Error("HTTP " + xhr.status));
      }
    };

    xhr.onerror = function () {
      cbErr(new Error("XHR error"));
    };

    xhr.ontimeout = function () {
      cbErr(new Error("XHR timeout"));
    };

    xhr.send();
  } catch (e) {
    cbErr(e);
  }
}

function toFileUrl(fileObj) {
  // Most Tizen web apps can use file.toURI() => "file:///..."
  try {
    return fileObj.toURI();
  } catch (e) {
    // fallback:
    return "file:///" + fileObj.fullPath;
  }
}

/**
 * cachePlaylistMedia(items, done)
 * - downloads each item if not already cached
 * - sets item.localPath
 */
function cachePlaylistMedia(items, done) {
  if (!items || !items.length) return done([]);

  if (!isTizen()) {
    console.warn("Not running on Tizen - skipping cache, using remote URLs.");
    // Still normalize localPath as remote
    items.forEach(function (it) {
      it.localPath = it.localPath || it.url || it.src || it.file || it.media_url || it.path;
    });
    return done(items);
  }

  resolveDocumentsDir(
    function (docDir) {
      ensureCacheFolder(
        docDir,
        function (cacheDir) {
          let idx = 0;

          function next() {
            if (idx >= items.length) {
              saveCachedPlaylist(items);
              return done(items);
            }

            const item = items[idx++];
            // Layout / web items render live in an iframe at runtime — never download their HTML
            // page as a file (that would set localPath and break the iframe). Stream them live.
            var _liveType = (item.type || item.media_type || "").toLowerCase();
            if (_liveType === "layout" || _liveType === "web" || _liveType === "url" ||
                _liveType === "webpage" || _liveType === "html" || _liveType === "dashboard") {
              return next();
            }
            const url = item.url || item.src || item.file || item.media_url || item.path;

            if (!url) {
              console.warn("No URL for item, skipping:", item);
              return next();
            }

            const filename = buildCacheFilename(item);

            fileExists(cacheDir, filename, function (exists) {
              if (exists) {
                cacheDir.resolve(
                  filename,
                  function (f) {
                    item.localPath = toFileUrl(f);
                    // normalize type if missing
                    if (!item.type && item.media_type) item.type = item.media_type;
                    return next();
                  },
                  function () {
                    // could not resolve even though exists check said yes
                    return next();
                  }
                );
              } else {
                // Create file and download it
                let fileObj;
                try {
                  fileObj = cacheDir.createFile(filename);
                } catch (e) {
                  console.warn("createFile failed:", e);
                  return next();
                }

                console.log("⬇ Downloading:", url, "=>", filename);

                downloadToFile(
                  url,
                  fileObj,
                  function () {
                    item.localPath = toFileUrl(fileObj);
                    if (!item.type && item.media_type) item.type = item.media_type;
                    console.log("✅ Cached:", filename);
                    return next();
                  },
                  function (err) {
                    console.warn("❌ Cache failed for:", url, err);
                    // delete partial file if possible
                    try { cacheDir.deleteFile(filename); } catch (_) {}
                    return next(); // continue anyway
                  }
                );
              }
            });
          }

          next();
        },
        function (err) {
          console.warn("ensureCacheFolder failed:", err);
          done(items);
        }
      );
    },
    function (err) {
      console.warn("resolveDocumentsDir failed:", err);
      done(items);
    }
  );
}