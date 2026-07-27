// Firebase Firestore REST API-backed key-value storage.
// Keeps the same get/set/delete/list async shape — only the backing store changed.
//
// Firestore security rules (Firebase console → Firestore → Rules):
//   rules_version = '2';
//   service cloud.firestore {
//     match /databases/{database}/documents {
//       match /debt_tracker/{document=**} {
//         allow read, write: if true;
//       }
//     }
//   }
//
// Config needed: projectId, apiKey
// Data lives in collection "debt_tracker", one document per key.

const CONFIG_KEY = "__firebase_config__";
const COLLECTION = "debt_tracker";

export function getConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) || "null");
  } catch (e) {
    return null;
  }
}

export function setConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function clearConfig() {
  localStorage.removeItem(CONFIG_KEY);
}

function docUrl(config, key) {
  const docId = encodeURIComponent(key);
  return `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents/${COLLECTION}/${docId}?key=${config.apiKey}`;
}

function colUrl(config) {
  return `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents/${COLLECTION}?key=${config.apiKey}`;
}

async function checkResponse(res) {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const b = await res.json();
      if (b.error?.message) msg = b.error.message;
    } catch (e) {}
    throw new Error(msg);
  }
  return res.json();
}

export async function testConnection(config) {
  const res = await fetch(colUrl(config) + "&pageSize=1", {
    headers: { "Content-Type": "application/json" },
  });
  await checkResponse(res.clone ? res.clone() : res);
  return true;
}

export const storage = {
  async get(key) {
    const config = getConfig();
    if (!config) throw new Error("Firebase тохиргоо хийгдээгүй байна");
    let res;
    try {
      res = await fetch(docUrl(config, key));
    } catch (e) {
      throw new Error("Сүлжээний алдаа: " + e.message);
    }
    if (res.status === 404) throw new Error(`Key not found: ${key}`);
    const data = await checkResponse(res);
    const value = data?.fields?.value?.stringValue;
    if (value === undefined) throw new Error(`Key not found: ${key}`);
    return { key, value };
  },

  async set(key, value) {
    const config = getConfig();
    if (!config) throw new Error("Firebase тохиргоо хийгдээгүй байна");
    const url = docUrl(config, key) + "&updateMask.fieldPaths=value";
    let res;
    try {
      res = await fetch(url.replace("?key=", `?key=`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { value: { stringValue: value } } }),
      });
    } catch (e) {
      throw new Error("Сүлжээний алдаа: " + e.message);
    }
    // Build a clean PATCH url (updateMask needs to be separate query param)
    const patchUrl = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents/${COLLECTION}/${encodeURIComponent(key)}?updateMask.fieldPaths=value&key=${config.apiKey}`;
    res = await fetch(patchUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { value: { stringValue: value } } }),
    });
    await checkResponse(res);
    return { key, value };
  },

  async delete(key) {
    const config = getConfig();
    if (!config) throw new Error("Firebase тохиргоо хийгдээгүй байна");
    const res = await fetch(docUrl(config, key), { method: "DELETE" });
    if (!res.ok && res.status !== 404) await checkResponse(res);
    return { key, deleted: true };
  },

  async list(prefix) {
    const config = getConfig();
    if (!config) throw new Error("Firebase тохиргоо хийгдээгүй байна");
    const res = await fetch(colUrl(config), {
      headers: { "Content-Type": "application/json" },
    });
    const data = await checkResponse(res);
    const docs = data.documents || [];
    const keys = docs
      .map((d) => d.name.split("/").pop())
      .filter((k) => !prefix || k.startsWith(prefix));
    return { keys };
  },
};
