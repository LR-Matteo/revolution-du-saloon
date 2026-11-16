// Registre de la pétition PCUS × FPLUS : revendications + signatures chaînées SHA-256.
// Stockage : Netlify Blobs (un seul document JSON, écritures conditionnelles par ETag).
import { getStore } from "@netlify/blobs";
import { createHash, randomUUID } from "node:crypto";

export const config = { path: "/api/*" };

const CLE = "registre";
const FORMAT = "PCUS-FPLUS/sig-v2";
const SEP = "␞";
const ZERO = "0".repeat(64);
const QUALITES = [
  "Militant de base",
  "Membre du Bureau politique",
  "Commissaire du peuple",
  "Délégué syndical du comptoir",
  "Sympathisant de la première heure",
  "Repenti de l'ancien régime",
];
const MAX_REV = 60;
const MAX_SIG = 1000;

export const sha = (s) => createHash("sha256").update(String(s), "utf8").digest("hex");
export const canon = (r) => [FORMAT, r.n, r.nom, r.qualite, r.date, r.sigHash, r.textHash, r.prev].join(SEP);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const reponse = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const initial = () => ({
  revendications: [
    { id: "art-001", texte: "Destitution des pouvoirs du chef Florent Brochard", date: "2026-11-16T17:50:00.000Z" },
  ],
  signatures: [],
});

function codeAdmin() {
  try { if (globalThis.Netlify && Netlify.env) return Netlify.env.get("ADMIN_CODE") || ""; } catch (e) {}
  return process.env.ADMIN_CODE || "";
}

function vuePublique(s) {
  if (s.retire) return { id: s.id, n: s.n, date: s.date, prev: s.prev, hash: s.hash, retire: true, dateRetrait: s.dateRetrait };
  const { tokenHash, ...rest } = s;
  return rest;
}

const normaliser = (t) => String(t).normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

async function lire(store) {
  const r = await store.getWithMetadata(CLE, { type: "json" });
  return r && r.data ? { data: r.data, etag: r.etag } : { data: initial(), etag: null };
}

async function modifier(store, fn) {
  for (let essai = 0; essai < 6; essai++) {
    const { data, etag } = await lire(store);
    const resultat = fn(data);
    const opts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
    const w = await store.setJSON(CLE, data, opts);
    if (!w || w.modified !== false) return resultat;
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 240));
  }
  throw new HttpError(503, "Le registre est très sollicité, réessaie dans un instant.");
}

async function corps(req) {
  try { return await req.json(); } catch (e) { throw new HttpError(400, "Requête illisible."); }
}

export async function traiter(req, store) {
  const url = new URL(req.url);
  const morceaux = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [ressource, id] = morceaux;
  const admin = codeAdmin();
  const estAdmin = !!admin && req.headers.get("x-admin-code") === admin;

  try {
    if (req.method === "GET" && ressource === "etat") {
      const { data } = await lire(store);
      return reponse({
        revendications: data.revendications,
        signatures: data.signatures.map(vuePublique),
        moderation: !!admin,
        format: FORMAT,
      });
    }

    if (req.method === "POST" && ressource === "admin") {
      if (!admin) throw new HttpError(404, "La modération n'est pas activée sur ce site.");
      if (!estAdmin) throw new HttpError(403, "Code de modération incorrect.");
      return reponse({ ok: true });
    }

    if (ressource === "revendications" && req.method === "POST" && !id) {
      const b = await corps(req);
      const texte = String(b.texte || "").replace(/\s+/g, " ").trim();
      if (texte.length < 4 || texte.length > 240) throw new HttpError(400, "Une revendication fait entre 4 et 240 caractères.");
      const rev = await modifier(store, (data) => {
        if (data.revendications.length >= MAX_REV) throw new HttpError(409, "Le programme du Parti est complet.");
        if (data.revendications.some((r) => normaliser(r.texte) === normaliser(texte))) throw new HttpError(409, "Cette revendication figure déjà au programme.");
        const r = { id: randomUUID(), texte, date: new Date().toISOString() };
        data.revendications.push(r);
        return r;
      });
      return reponse(rev, 201);
    }

    if (ressource === "revendications" && req.method === "DELETE" && id) {
      if (!estAdmin) throw new HttpError(403, "Seul le modérateur peut retirer une revendication.");
      await modifier(store, (data) => {
        data.revendications = data.revendications.filter((r) => r.id !== id);
      });
      return reponse({ ok: true });
    }

    if (ressource === "signatures" && req.method === "POST" && !id) {
      const b = await corps(req);
      const nom = String(b.nom || "").replace(/\s+/g, " ").trim();
      const qualite = String(b.qualite || "");
      const signature = String(b.signature || "");
      const jeton = String(b.jeton || "");
      if (nom.length < 2 || nom.length > 80) throw new HttpError(400, "Indique un nom entre 2 et 80 caractères.");
      if (!QUALITES.includes(qualite)) throw new HttpError(400, "Qualité inconnue.");
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) || signature.length > 300000) throw new HttpError(400, "Le tracé de signature est invalide.");
      if (jeton.length < 16 || jeton.length > 128) throw new HttpError(400, "Jeton de signataire invalide.");
      const tokenHash = sha(jeton);
      const rec = await modifier(store, (data) => {
        const actives = data.signatures.filter((s) => !s.retire);
        if (actives.length >= MAX_SIG) throw new HttpError(409, "Le registre est plein.");
        if (actives.some((s) => s.tokenHash === tokenHash)) throw new HttpError(409, "Ce navigateur a déjà signé la pétition.");
        if (actives.some((s) => normaliser(s.nom) === normaliser(nom))) throw new HttpError(409, "Ce nom figure déjà au registre.");
        const dernier = data.signatures[data.signatures.length - 1];
        const r = {
          id: randomUUID(),
          n: dernier ? dernier.n + 1 : 1,
          nom,
          qualite,
          date: new Date().toISOString(),
          signature,
          sigHash: sha(signature),
          textHash: sha(data.revendications.map((x) => x.texte).join("\n")),
          prev: dernier ? dernier.hash : ZERO,
          tokenHash,
        };
        r.hash = sha(canon(r));
        data.signatures.push(r);
        return r;
      });
      return reponse(vuePublique(rec), 201);
    }

    if (ressource === "signatures" && req.method === "DELETE" && id) {
      const b = await corps(req).catch(() => ({}));
      const tokenHash = b && b.jeton ? sha(String(b.jeton)) : null;
      await modifier(store, (data) => {
        const s = data.signatures.find((x) => x.id === id && !x.retire);
        if (!s) throw new HttpError(404, "Signature introuvable.");
        if (!estAdmin && s.tokenHash !== tokenHash) throw new HttpError(403, "Seul le signataire ou le modérateur peut retirer cette signature.");
        // Le maillon reste dans la chaîne (n, prev, hash) pour que la suite reste vérifiable.
        for (const k of ["nom", "qualite", "signature", "sigHash", "textHash", "tokenHash"]) delete s[k];
        s.retire = true;
        s.dateRetrait = new Date().toISOString();
      });
      return reponse({ ok: true });
    }

    throw new HttpError(404, "Route inconnue.");
  } catch (e) {
    if (e instanceof HttpError) return reponse({ erreur: e.message }, e.status);
    console.error(e);
    return reponse({ erreur: "Erreur interne du registre." }, 500);
  }
}

export default async (req) => traiter(req, getStore({ name: "petition-pcus", consistency: "strong" }));
