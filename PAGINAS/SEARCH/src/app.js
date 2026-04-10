/* ═══════════════════════════════════════════════════════════════════
   PACKSEARCH  v3 — Parser duplo: CSV tabular + blocos chave:valor
   com IndexedDB, Highlighting, View Toggle e Modal de Confirmação
   ═══════════════════════════════════════════════════════════════════ */

/* ─── 0. Utils ──────────────────────────────────────────────────── */
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

/* Debug log visual */
const debugLines = [];
function dbg(msg, type = "info") {
	console.log(`[PS] ${msg}`);
	debugLines.push({ msg, type });
	if (debugLines.length > 200) debugLines.shift();
	const panel = $("#debugPanel");
	if (panel && panel.classList.contains("show")) renderDebug();
}
function renderDebug() {
	const panel = $("#debugPanel");
	panel.innerHTML = debugLines
		.map((l) => `<div class="log-${l.type}">${l.msg}</div>`)
		.join("");
	panel.scrollTop = panel.scrollHeight;
}
$("#debugToggle").addEventListener("click", () => {
	const p = $("#debugPanel");
	p.classList.toggle("show");
	if (p.classList.contains("show")) renderDebug();
});

/* ─── 1. Toast ──────────────────────────────────────────────────── */
function toast(msg, type = "info", duration = 3500) {
	const icons = {
		success: "✅",
		error: "❌",
		info: "ℹ️",
		warn: "⚠️",
	};
	const el = document.createElement("div");
	el.className = `toast ${type}`;
	el.innerHTML = `<span>${icons[type] || "📌"}</span><span>${msg}</span>`;
	$("#toastContainer").appendChild(el);
	setTimeout(() => {
		el.classList.add("toast-fade-out");
		setTimeout(() => el.remove(), 420);
	}, duration);
}

function setProgress(p) {
	const bar = $("#progressBar");
	bar.style.width = p + "%";
	if (p >= 100) setTimeout(() => (bar.style.width = "0"), 600);
}

/* ─── 2. Normalização ───────────────────────────────────────────── */
function normalizeKey(k) {
	return (k || "")
		.trim()
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/\s+/g, "_")
		.replace(/[^a-z0-9_]/g, "");
}

function normalizeText(t) {
	return (t || "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");
}

/* Meses PT-BR */
const MONTHS = {
	jan: 0,
	fev: 1,
	mar: 2,
	abr: 3,
	mai: 4,
	jun: 5,
	jul: 6,
	ago: 7,
	set: 8,
	out: 9,
	nov: 10,
	dez: 11,
};

function parsePtDate(str) {
	if (!str) return null;
	const m = (str + "").match(
		/(\d{1,2})\s+de\s+([a-záéíóú\.]+)\s+de\s+(\d{4})/i,
	);
	if (!m) return null;
	const mon = m[2].toLowerCase().replace(/\./g, "").slice(0, 3);
	const month = MONTHS[mon];
	if (month === undefined) return null;
	return new Date(+m[3], month, +m[1]);
}

function formatDate(d) {
	if (!d || isNaN(d)) return "—";
	return d.toLocaleDateString("pt-BR", {
		day: "2-digit",
		month: "short",
		year: "numeric",
	});
}

/* ─── 3. Mapeamento de colunas CSV → campos internos ──────────── */
const COL_MAP = {
	id: "id",
	shipment: "id",
	descricao: "descricao",
	descri: "descricao",
	svc: "svc",
	shp_lg_facility_id: "svc",
	tramo: "tramo",
	status: "status",
	atualizacao: "atualizacaoRaw",
	atualizao: "atualizacaoRaw",
	shipped_date: "atualizacaoRaw",
	valor_usd: "usd",
	hu: "hu",
	ultimo_step: "ultimoStep",
	ltimo_step: "ultimoStep",
	origem: "origem",
	qtd_dias_eta: "etaDias",
	reclamacao: "reclamacao",
	reclamao: "reclamacao",
	placa: "placa",
	svc_inventario: "svcInventario",
	svc_inventrio: "svcInventario",
	shipped_user: "shippedUser",
};

function resolveCol(rawHeader) {
	const nk = normalizeKey(rawHeader);
	if (COL_MAP[nk]) return COL_MAP[nk];
	for (const [alias, field] of Object.entries(COL_MAP)) {
		if (nk.startsWith(alias) || alias.startsWith(nk)) return field;
	}
	return nk;
}

/* ─── 4. CSV Tabular Parser ───────────────────────────────────── */
function splitCSVLine(line) {
	const result = [];
	let cur = "";
	let inQuote = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			if (inQuote && line[i + 1] === '"') {
				cur += '"';
				i++;
			} else inQuote = !inQuote;
		} else if (ch === "," && !inQuote) {
			result.push(cur);
			cur = "";
		} else {
			cur += ch;
		}
	}
	result.push(cur);
	return result;
}

function detectSeparator(headerLine) {
	const counts = { ",": 0, ";": 0, "\t": 0, "|": 0 };
	let inQ = false;
	for (const ch of headerLine) {
		if (ch === '"') {
			inQ = !inQ;
			continue;
		}
		if (!inQ && counts[ch] !== undefined) counts[ch]++;
	}
	return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function splitLine(line, sep) {
	if (sep === ",") return splitCSVLine(line);
	const result = [];
	let cur = "";
	let inQuote = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			inQuote = !inQuote;
		} else if (ch === sep && !inQuote) {
			result.push(cur);
			cur = "";
		} else {
			cur += ch;
		}
	}
	result.push(cur);
	return result;
}

function parseCSVTabular(text) {
	const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
	if (lines.length < 2) return [];

	const sep = detectSeparator(lines[0]);
	dbg(`Separador detectado: "${sep === "\t" ? "TAB" : sep}"`, "info");

	const rawHeaders = splitLine(lines[0], sep);
	const headers = rawHeaders.map((h) => h.replace(/^"|"$/g, "").trim());
	dbg(`Headers (${headers.length}): ${headers.join(" | ")}`, "info");

	const colFields = headers.map(resolveCol);
	dbg(`Campos mapeados: ${colFields.join(" | ")}`, "info");

	const items = [];
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim()) continue;
		const vals = splitLine(line, sep).map((v) =>
			v.replace(/^"|"$/g, "").trim(),
		);
		const raw = {};
		for (let c = 0; c < colFields.length; c++) {
			const field = colFields[c];
			const value = vals[c] !== undefined ? vals[c] : "";
			if (!raw[field] || raw[field] === "-" || raw[field] === "null") {
				raw[field] = value;
			}
		}
		const item = buildItem(raw);
		if (item.id) items.push(item);
	}
	return items;
}

/* ─── 5. Parser Bloco chave:valor ────────────────────────────────── */
function parseKVBlocks(text) {
	const lines = text.split(/\r?\n/);
	const items = [];
	let current = null;
	const KV_RE = /^([^:]+?):\s*(.*)$/;

	function flush() {
		if (current && current.id) {
			items.push(buildItem(current));
		}
		current = null;
	}

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const m = trimmed.match(KV_RE);
		if (!m) continue;

		const rawKey = m[1].trim();
		const value = m[2].trim();
		const field = resolveCol(rawKey);

		if (field === "id") {
			if (current && current.id) flush();
			if (!current) current = {};
			current.id = value;
		} else {
			if (!current) current = {};
			if (!current[field]) current[field] = value;
		}
	}
	flush();
	return items;
}

/* ─── 6. Fallback regex ─────────────────────────────────────────── */
function parseFallbackRegex(text) {
	const items = [];
	const re = /(ID|Shipment):\s*(\d{8,})/gi;
	let m;
	while ((m = re.exec(text)) !== null) {
		items.push(buildItem({ id: m[2] }));
	}
	return items;
}

/* ─── 7. buildItem: raw → item padronizado ──────────────────────── */
function buildItem(raw) {
	const get = (...keys) => {
		for (const k of keys) {
			const v = raw[k];
			if (
				v &&
				v !== "-" &&
				v !== "null" &&
				v !== "undefined" &&
				v.trim() !== ""
			)
				return v.trim();
		}
		return "";
	};

	const usdRaw = get("usd");
	const etaRaw = get("etaDias");
	const atuRaw = get("atualizacaoRaw");

	const item = {
		id: get("id"),
		descricao: get("descricao"),
		svc: get("svc"),
		tramo: get("tramo"),
		status: get("status"),
		atualizacaoRaw: atuRaw,
		atualizacao: parsePtDate(atuRaw),
		usd: usdRaw ? parseFloat(usdRaw) : null,
		hu: get("hu"),
		ultimoStep: get("ultimoStep"),
		origem: get("origem"),
		etaDias: etaRaw ? parseInt(etaRaw, 10) : null,
		reclamacao: get("reclamacao"),
		placa: get("placa"),
		svcInventario: get("svcInventario"),
		shippedUser: get("shippedUser"),
		_extra: {},
	};

	item._isEnrichment = !item.descricao;

	const knownInternals = new Set([
		"id",
		"descricao",
		"svc",
		"tramo",
		"status",
		"atualizacaoRaw",
		"usd",
		"hu",
		"ultimoStep",
		"origem",
		"etaDias",
		"reclamacao",
		"placa",
		"svcInventario",
		"shippedUser",
	]);
	for (const [k, v] of Object.entries(raw)) {
		if (!knownInternals.has(k) && v) item._extra[k] = v;
	}

	item._searchBlob = buildBlob(item);
	return item;
}

function buildBlob(item) {
	return normalizeText(
		[
			item.id,
			item.descricao,
			item.svc,
			item.tramo,
			item.status,
			item.hu,
			item.ultimoStep,
			item.origem,
			item.placa,
			item.reclamacao,
			item.svcInventario,
			...Object.values(item._extra || {}),
		]
			.filter(Boolean)
			.join(" "),
	);
}

/* ─── 8. Orquestrador de parse ──────────────────────────────────── */
function parseFileContent(text, filename) {
	dbg(`─── Processando: ${filename} (${text.length} chars) ───`, "info");

	const lines = text.split(/\r?\n/).filter((l) => l.trim());
	if (!lines.length) {
		dbg("Arquivo vazio!", "err");
		return [];
	}

	const firstLine = lines[0];
	const sep = detectSeparator(firstLine);
	const firstCols = splitLine(firstLine, sep).length;

	dbg(
		`Primeira linha tem ${firstCols} colunas com sep="${sep === "\t" ? "TAB" : sep}"`,
		"info",
	);
	dbg(`Amostra: ${firstLine.slice(0, 120)}`, "info");

	let items = [];

	if (firstCols >= 2) {
		dbg("→ Tentando CSV Tabular...", "info");
		items = parseCSVTabular(text);
		dbg(
			`CSV Tabular: ${items.length} itens`,
			items.length > 0 ? "ok" : "warn",
		);
	}

	if (items.length === 0) {
		dbg("→ Tentando Blocos KV...", "info");
		items = parseKVBlocks(text);
		dbg(
			`Blocos KV: ${items.length} itens`,
			items.length > 0 ? "ok" : "warn",
		);
	}

	if (items.length === 0) {
		dbg("→ Fallback Regex...", "warn");
		items = parseFallbackRegex(text);
		dbg(
			`Fallback Regex: ${items.length} itens`,
			items.length > 0 ? "ok" : "err",
		);
	}

	dbg(
		`Total parseado de "${filename}": ${items.length} itens`,
		items.length > 0 ? "ok" : "err",
	);

	if (items.length > 0) {
		const sample = items[0];
		dbg(
			`Amostra[0] id="${sample.id}" svc="${sample.svc}" tramo="${sample.tramo}" status="${sample.status}" usd="${sample.usd}" desc="${(sample.descricao || "").slice(0, 40)}"`,
			"ok",
		);
	}

	return items;
}

/* ═══════════════════════════════════════════════════════════════════
   IndexedDB — Armazenamento de dados pesados (substitui localStorage)
   ═══════════════════════════════════════════════════════════════════ */
const IDB_NAME = "PackSearchDB";
const IDB_VERSION = 2;
const IDB_STORE = "data";

let _db = null;

function openDB() {
	if (_db) {
		try {
			_db.transaction(IDB_STORE);
			return Promise.resolve(_db);
		} catch (e) {
			dbg(
				`Conexão anterior inválida: ${e.message}, reconectando...`,
				"warn",
			);
			_db = null;
		}
	}

	return new Promise((resolve, reject) => {
		try {
			const req = indexedDB.open(IDB_NAME, IDB_VERSION);

			req.onupgradeneeded = (event) => {
				dbg("IndexedDB: executando upgrade...", "info");
				const db = event.target.result;

				// Remove store antigo se existir
				if (db.objectStoreNames.contains(IDB_STORE)) {
					dbg(`Removendo objeto store antigo: ${IDB_STORE}`, "info");
					db.deleteObjectStore(IDB_STORE);
				}

				// Cria novo store
				try {
					db.createObjectStore(IDB_STORE);
					dbg(`Object store criado: ${IDB_STORE}`, "ok");
				} catch (e) {
					dbg(`Erro ao criar object store: ${e.message}`, "err");
				}
			};

			req.onsuccess = () => {
				_db = req.result;
				dbg("IndexedDB conectado com sucesso", "ok");
				resolve(_db);
			};

			req.onerror = () => {
				dbg(`Erro ao abrir IndexedDB: ${req.error}`, "err");
				reject(new Error(`IndexedDB error: ${req.error}`));
			};

			req.onblocked = () => {
				dbg(
					"IndexedDB: requisição bloqueada (feche outras abas)",
					"warn",
				);
			};
		} catch (e) {
			dbg(`Erro ao abrir IndexedDB: ${e.message}`, "err");
			reject(e);
		}
	});
}

async function idbSet(key, value) {
	try {
		const db = await openDB();
		return new Promise((resolve, reject) => {
			try {
				const tx = db.transaction(IDB_STORE, "readwrite");
				const store = tx.objectStore(IDB_STORE);
				const req = store.put(value, key);

				req.onsuccess = () => {
					dbg(
						`IndexedDB: "${key}" salvo com sucesso (${JSON.stringify(value).length} bytes)`,
						"ok",
					);
				};

				req.onerror = () => {
					dbg(`Erro no put "${key}": ${req.error}`, "err");
					reject(req.error);
				};

				tx.oncomplete = () => {
					resolve();
				};

				tx.onerror = () => {
					dbg(`Erro na transação idbSet: ${tx.error}`, "err");
					reject(tx.error);
				};
			} catch (e) {
				dbg(`Erro na transação idbSet: ${e.message}`, "err");
				reject(e);
			}
		});
	} catch (e) {
		dbg(`Falha ao salvar no IndexedDB: ${e.message}`, "err");
		throw e;
	}
}

async function idbGet(key) {
	try {
		const db = await openDB();
		return new Promise((resolve, reject) => {
			try {
				const tx = db.transaction(IDB_STORE, "readonly");
				const req = tx.objectStore(IDB_STORE).get(key);

				req.onsuccess = () => {
					const result = req.result;
					if (result) {
						dbg(
							`IndexedDB: "${key}" recuperado (${JSON.stringify(result).length} bytes)`,
							"ok",
						);
					} else {
						dbg(`IndexedDB: "${key}" não encontrado`, "info");
					}
					resolve(result);
				};

				req.onerror = () => {
					dbg(`Erro ao recuperar "${key}": ${req.error}`, "err");
					reject(req.error);
				};
			} catch (e) {
				dbg(`Erro na transação idbGet: ${e.message}`, "err");
				reject(e);
			}
		});
	} catch (e) {
		dbg(`Falha ao carregar do IndexedDB: ${e.message}`, "err");
		throw e;
	}
}

async function idbDel(key) {
	try {
		const db = await openDB();
		return new Promise((resolve, reject) => {
			try {
				const tx = db.transaction(IDB_STORE, "readwrite");
				const req = tx.objectStore(IDB_STORE).delete(key);

				req.onsuccess = () => {
					dbg(`IndexedDB: "${key}" deletado`, "ok");
				};

				req.onerror = () => {
					dbg(`Erro ao deletar "${key}": ${req.error}`, "err");
					reject(req.error);
				};

				tx.oncomplete = () => {
					resolve();
				};

				tx.onerror = () => {
					dbg(`Erro na transação idbDel: ${tx.error}`, "err");
					reject(tx.error);
				};
			} catch (e) {
				dbg(`Erro na transação idbDel: ${e.message}`, "err");
				reject(e);
			}
		});
	} catch (e) {
		dbg(`Falha ao deletar do IndexedDB: ${e.message}`, "err");
		throw e;
	}
}

/* ─── 9. Store / Merge ──────────────────────────────────────────── */
const STORE_KEY = "ps_items_v4";
const FILTERS_KEY = "ps_filters_v4";
const THEME_KEY = "ps_theme_v1";
const VIEW_KEY = "ps_view_v1";

let allItems = [];
let itemsMap = new Map();
let dataSource = "empty";
let savedAt = null;
let currentView = "list";

function mergeIntoExisting(existing, incoming) {
	const fields = [
		"descricao",
		"svc",
		"tramo",
		"status",
		"atualizacaoRaw",
		"hu",
		"ultimoStep",
		"origem",
		"reclamacao",
		"placa",
		"svcInventario",
		"shippedUser",
	];
	for (const f of fields) {
		if (
			incoming[f] &&
			(!existing[f] || existing[f] === "" || existing[f] === "null")
		) {
			existing[f] = incoming[f];
		}
	}
	if (
		incoming.usd !== null &&
		!isNaN(incoming.usd) &&
		(existing.usd === null || isNaN(existing.usd))
	) {
		existing.usd = incoming.usd;
	}
	if (
		incoming.etaDias !== null &&
		!isNaN(incoming.etaDias) &&
		(existing.etaDias === null || isNaN(existing.etaDias))
	) {
		existing.etaDias = incoming.etaDias;
	}
	if (!existing.atualizacao && incoming.atualizacaoRaw) {
		existing.atualizacao = parsePtDate(incoming.atualizacaoRaw);
	}
	for (const [k, v] of Object.entries(incoming._extra || {})) {
		if (v && !existing._extra[k]) existing._extra[k] = v;
	}
	existing._searchBlob = buildBlob(existing);
}

function ingestItems(newItems) {
	let added = 0,
		merged = 0;
	for (const item of newItems) {
		if (!item.id) continue;
		if (!item._extra) item._extra = {};
		
		if (itemsMap.has(item.id)) {
			const existingGroup = itemsMap.get(item.id);
			for (const ex of existingGroup) {
				mergeIntoExisting(ex, item);
				mergeIntoExisting(item, ex);
			}
			
			if (item._isEnrichment) {
				merged++;
			} else {
				const ghostIdx = existingGroup.findIndex(x => x._isEnrichment);
				if (ghostIdx !== -1) {
					existingGroup[ghostIdx]._isEnrichment = false;
					merged++;
				} else {
					existingGroup.push(item);
					allItems.push(item);
					added++;
					merged++;
				}
			}
		} else {
			itemsMap.set(item.id, [item]);
			allItems.push(item);
			added++;
		}
	}
	return { added, merged };
}

/* saveItems: salva dados pesados no IndexedDB */
async function saveItems() {
	try {
		await idbSet(STORE_KEY, {
			items: allItems,
			savedAt: new Date().toISOString(),
		});
		dataSource = "cache";
		savedAt = new Date();
		dbg(`Cache salvo (IndexedDB): ${allItems.length} itens`, "ok");
	} catch (e) {
		dbg(`Erro ao salvar cache: ${e.message}`, "err");
		toast(
			"Falha ao salvar dados no IndexedDB. Dados em memória.",
			"warn",
		);
		dataSource = "memory";
	}
	updateCacheBadge();
}

/* loadItems: carrega dados pesados do IndexedDB */
async function loadItems() {
	try {
		const payload = await idbGet(STORE_KEY);
		if (!payload || !payload.items || !payload.items.length) {
			dbg("Nenhum cache encontrado no IndexedDB", "info");
			return false;
		}
		allItems = payload.items;
		itemsMap = new Map();
		for (const it of allItems) {
			it.atualizacao = it.atualizacao
				? new Date(it.atualizacao)
				: parsePtDate(it.atualizacaoRaw);
			if (!it._extra) it._extra = {};
			it._searchBlob = buildBlob(it);
			
			if (!itemsMap.has(it.id)) {
				itemsMap.set(it.id, []);
			}
			itemsMap.get(it.id).push(it);
		}
		savedAt = payload.savedAt ? new Date(payload.savedAt) : null;
		dataSource = "cache";
		dbg(`Cache restaurado (IndexedDB): ${allItems.length} itens`, "ok");
		return true;
	} catch (e) {
		dbg(`Erro ao carregar cache: ${e.message}`, "err");
		return false;
	}
}

/* clearItems: limpa dados do IndexedDB */
async function clearItems() {
	allItems = [];
	itemsMap = new Map();
	dataSource = "empty";
	savedAt = null;
	try {
		await idbDel(STORE_KEY);
		dbg("IndexedDB: dados deletados", "ok");
	} catch (e) {
		dbg(`Erro ao limpar IndexedDB: ${e.message}`, "err");
	}
	updateCacheBadge();
}

/* ─── 10. Filtros / Estado (localStorage — apenas preferências) ── */
const state = {
	globalSearch: "",
	quickSearch: "",
	svcSet: new Set(),
	tramoSet: new Set(),
	statusSet: new Set(),
	dateFrom: null,
	dateTo: null,
	usdMin: null,
	usdMax: null,
	sort: "relevance",
	page: 1,
	pageSize: 24,
};

function saveFilters() {
	localStorage.setItem(
		FILTERS_KEY,
		JSON.stringify({
			globalSearch: state.globalSearch,
			quickSearch: state.quickSearch,
			svcSet: [...state.svcSet],
			tramoSet: [...state.tramoSet],
			statusSet: [...state.statusSet],
			dateFrom: state.dateFrom,
			dateTo: state.dateTo,
			usdMin: state.usdMin,
			usdMax: state.usdMax,
			sort: state.sort,
			pageSize: state.pageSize,
		}),
	);
}

function loadFilters() {
	try {
		const p = JSON.parse(localStorage.getItem(FILTERS_KEY) || "{}");
		if (p.globalSearch) state.globalSearch = p.globalSearch;
		if (p.quickSearch) state.quickSearch = p.quickSearch;
		if (p.svcSet) state.svcSet = new Set(p.svcSet);
		if (p.tramoSet) state.tramoSet = new Set(p.tramoSet);
		if (p.statusSet) state.statusSet = new Set(p.statusSet);
		if (p.dateFrom) state.dateFrom = p.dateFrom;
		if (p.dateTo) state.dateTo = p.dateTo;
		state.usdMin = p.usdMin ?? null;
		state.usdMax = p.usdMax ?? null;
		state.sort = p.sort || "relevance";
		state.pageSize = p.pageSize || 24;
	} catch (e) {
		dbg(`Erro ao carregar filtros: ${e.message}`, "warn");
	}
}

/* ─── 11. Busca avançada ────────────────────────────────────────── */
function parseQuery(raw) {
	const tokens = [];
	let q = raw;
	const fieldRe = /(\w+):"([^"]+)"|(\w+):(\S+)/g;
	const knownF = new Set([
		"id",
		"svc",
		"tramo",
		"status",
		"hu",
		"origem",
		"placa",
		"eta",
	]);
	let fm;
	while ((fm = fieldRe.exec(raw)) !== null) {
		const field = (fm[1] || fm[3]).toLowerCase();
		const value = (fm[2] || fm[4]).toLowerCase();
		if (knownF.has(field)) {
			tokens.push({ type: "field", field, value });
			q = q.replace(fm[0], "");
		}
	}
	const phraseRe = /"([^"]+)"/g;
	let pm;
	while ((pm = phraseRe.exec(q)) !== null) {
		tokens.push({ type: "must", value: normalizeText(pm[1]) });
		q = q.replace(pm[0], "");
	}
	for (const w of q.split(/\s+/).filter(Boolean)) {
		if (w.startsWith("-") && w.length > 1)
			tokens.push({ type: "not", value: normalizeText(w.slice(1)) });
		else tokens.push({ type: "must", value: normalizeText(w) });
	}
	return tokens.filter((t) => t.value);
}

function matchesQuery(item, tokens) {
	if (!tokens.length) return true;
	const blob = item._searchBlob || "";
	for (const tok of tokens) {
		if (tok.type === "must") {
			if (!blob.includes(tok.value)) return false;
		} else if (tok.type === "not") {
			if (blob.includes(tok.value)) return false;
		} else if (tok.type === "field") {
			const fv = normalizeText(
				String(item[tok.field] || item._extra?.[tok.field] || ""),
			);
			if (!fv.includes(tok.value)) return false;
		}
	}
	return true;
}

/* ─── 12. Filtragem & ordenação ─────────────────────────────────── */
function getFiltered() {
	const gTokens = parseQuery(state.globalSearch);
	const qText = normalizeText(state.quickSearch);
	return allItems.filter((item) => {
		if (gTokens.length && !matchesQuery(item, gTokens)) return false;
		if (qText && !item._searchBlob.includes(qText)) return false;
		if (state.svcSet.size && !state.svcSet.has(item.svc)) return false;
		if (state.tramoSet.size && !state.tramoSet.has(item.tramo))
			return false;
		if (state.statusSet.size && !state.statusSet.has(item.status))
			return false;
		if (state.dateFrom && item.atualizacao) {
			if (item.atualizacao < new Date(state.dateFrom)) return false;
		}
		if (state.dateTo && item.atualizacao) {
			const dt = new Date(state.dateTo);
			dt.setHours(23, 59, 59);
			if (item.atualizacao > dt) return false;
		}
		if (
			state.usdMin !== null &&
			item.usd !== null &&
			item.usd < state.usdMin
		)
			return false;
		if (
			state.usdMax !== null &&
			item.usd !== null &&
			item.usd > state.usdMax
		)
			return false;
		return true;
	});
}

function sortItems(items) {
	const s = state.sort;
	const cp = [...items];
	const ts = (i) => (i.atualizacao ? i.atualizacao.getTime() : 0);
	if (s === "date_desc") cp.sort((a, b) => ts(b) - ts(a));
	else if (s === "date_asc") cp.sort((a, b) => ts(a) - ts(b));
	else if (s === "id_asc") cp.sort((a, b) => a.id.localeCompare(b.id));
	else if (s === "id_desc") cp.sort((a, b) => b.id.localeCompare(a.id));
	else if (s === "desc_az")
		cp.sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR"));
	else if (s === "usd_desc") cp.sort((a, b) => (b.usd || 0) - (a.usd || 0));
	else if (s === "usd_asc") cp.sort((a, b) => (a.usd || 0) - (b.usd || 0));
	else if (s === "eta_desc")
		cp.sort((a, b) => (b.etaDias || 0) - (a.etaDias || 0));
	return cp;
}

/* ═══════════════════════════════════════════════════════════════════
   HIGHLIGHTING — Marca palavras correspondentes nos cards
   ═══════════════════════════════════════════════════════════════════ */
function getHighlightTerms() {
	const terms = [];
	if (state.globalSearch) {
		const raw = state.globalSearch;
		const phraseRe = /"([^"]+)"/g;
		let m;
		while ((m = phraseRe.exec(raw)) !== null) terms.push(m[1]);
		const clean = raw
			.replace(/"[^"]*"/g, "")
			.replace(/\w+:"[^"]*"|\w+:\S+/g, "");
		for (const w of clean.split(/\s+/).filter(Boolean)) {
			if (!w.startsWith("-")) terms.push(w);
		}
	}
	if (state.quickSearch) {
		for (const w of state.quickSearch.split(/\s+/).filter(Boolean)) {
			terms.push(w);
		}
	}
	return [...new Set(terms.filter((t) => t.length > 0))];
}

function highlightText(text, terms) {
	if (!text || !terms || !terms.length) return text;
	const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	const re = new RegExp(`(${escaped.join("|")})`, "gi");
	return String(text).replace(re, '<mark class="highlight">$1</mark>');
}

/* ═══════════════════════════════════════════════════════════════════
   MODAL DE CONFIRMAÇÃO — Substitui o confirm() nativo
   ═══════════════════════════════════════════════════════════════════ */
function showConfirmModal(title, message) {
	return new Promise((resolve) => {
		const overlay = $("#confirmModal");
		$("#modalTitle").textContent = title;
		$("#confirmMessage").textContent = message;
		overlay.style.display = "flex";

		function cleanup(result) {
			overlay.style.display = "none";
			$("#modalCancelBtn").onclick = null;
			$("#modalConfirmBtn").onclick = null;
			overlay.onclick = null;
			document.removeEventListener("keydown", onKey);
			resolve(result);
		}

		function onKey(e) {
			if (e.key === "Escape") cleanup(false);
		}

		$("#modalCancelBtn").onclick = () => cleanup(false);
		$("#modalConfirmBtn").onclick = () => cleanup(true);
		overlay.onclick = (e) => {
			if (e.target === overlay) cleanup(false);
		};
		document.addEventListener("keydown", onKey);

		$("#modalConfirmBtn").focus();
	});
}

/* ─── 13. Render helpers ───────────────────────────────────────────── */
function updateCacheBadge() {
	const badge = $("#cacheBadge");
	badge.className = "";
	if (dataSource === "cache" && allItems.length) {
		const t = savedAt
			? savedAt.toLocaleString("pt-BR", {
					day: "2-digit",
					month: "2-digit",
					hour: "2-digit",
					minute: "2-digit",
				})
			: "—";
		badge.textContent = `✅ Cache ativo • ${allItems.length} itens • ${t}`;
		badge.classList.add("active");
	} else if (dataSource === "memory" && allItems.length) {
		badge.textContent = `🟡 Dados em memória • ${allItems.length} itens`;
		badge.classList.add("memory");
	} else {
		badge.textContent = "Cache: vazio";
	}
}

function buildChecklist(containerId, fieldName, activeSet, onChange) {
	const wrap = $(`#${containerId}`);
	if (!wrap) return;
	const counts = {};
	for (const item of allItems) {
		const v = item[fieldName] || "";
		if (v) counts[v] = (counts[v] || 0) + 1;
	}
	wrap.innerHTML = "";
	const values = Object.keys(counts).sort();
	for (const v of values) {
		const lbl = document.createElement("label");
		lbl.innerHTML = `
      <input type="checkbox" value="${v}" ${activeSet.has(v) ? "checked" : ""}>
      <span>${v || "(vazio)"}</span>
      <span class="checklist-count">${counts[v]}</span>`;
		lbl.querySelector("input").addEventListener("change", function () {
			this.checked ? activeSet.add(v) : activeSet.delete(v);
			state.page = 1;
			onChange();
		});
		wrap.appendChild(lbl);
	}
	if (!values.length)
		wrap.innerHTML =
			'<span style="font-size:12px;color:var(--text3)">Nenhum valor</span>';
}

function rebuildChecklists() {
	const refresh = () => {
		saveFilters();
		render();
	};
	buildChecklist("svcChecklist", "svc", state.svcSet, refresh);
	buildChecklist("tramoChecklist", "tramo", state.tramoSet, refresh);
	buildChecklist("statusChecklist", "status", state.statusSet, refresh);
}

function updateChips() {
	const chips = $("#activeChips");
	const section = $("#chipsSection");
	chips.innerHTML = "";
	const all = [];
	if (state.globalSearch)
		all.push({
			label: `🔍 "${state.globalSearch}"`,
			clear: () => {
				state.globalSearch = "";
				$("#globalSearch").value = "";
			},
		});
	if (state.quickSearch)
		all.push({
			label: `⚡ "${state.quickSearch}"`,
			clear: () => {
				state.quickSearch = "";
				$("#quickSearch").value = "";
			},
		});
	for (const v of state.svcSet)
		all.push({
			label: `SVC: ${v}`,
			clear: () => {
				state.svcSet.delete(v);
				rebuildChecklists();
			},
		});
	for (const v of state.tramoSet)
		all.push({
			label: `Tramo: ${v}`,
			clear: () => {
				state.tramoSet.delete(v);
				rebuildChecklists();
			},
		});
	for (const v of state.statusSet)
		all.push({
			label: `Status: ${v}`,
			clear: () => {
				state.statusSet.delete(v);
				rebuildChecklists();
			},
		});
	if (state.dateFrom)
		all.push({
			label: `De: ${state.dateFrom}`,
			clear: () => {
				state.dateFrom = null;
				$("#dateFrom").value = "";
			},
		});
	if (state.dateTo)
		all.push({
			label: `Até: ${state.dateTo}`,
			clear: () => {
				state.dateTo = null;
				$("#dateTo").value = "";
			},
		});
	if (state.usdMin !== null)
		all.push({
			label: `USD ≥ ${state.usdMin}`,
			clear: () => {
				state.usdMin = null;
				$("#usdMin").value = "";
			},
		});
	if (state.usdMax !== null)
		all.push({
			label: `USD ≤ ${state.usdMax}`,
			clear: () => {
				state.usdMax = null;
				$("#usdMax").value = "";
			},
		});
	section.style.display = all.length ? "" : "none";
	for (const c of all) {
		const chip = document.createElement("div");
		chip.className = "chip";
		chip.innerHTML = `${c.label}<button title="Remover">×</button>`;
		chip.querySelector("button").addEventListener("click", () => {
			c.clear();
			state.page = 1;
			saveFilters();
			updateChips();
			render();
		});
		chips.appendChild(chip);
	}
}

/* ─── 14. Render Cards (com highlighting) ───────────────────────── */
function etaClass(d) {
	if (d === null || isNaN(d)) return "";
	if (d >= 15) return "eta-high";
	if (d >= 7) return "eta-mid";
	return "";
}

function renderCard(item) {
	const terms = getHighlightTerms();
	const hl = (text) => highlightText(text, terms);

	const usdStr =
		item.usd !== null && !isNaN(item.usd) ? `$${item.usd.toFixed(2)}` : "—";
	const etaStr =
		item.etaDias !== null && !isNaN(item.etaDias)
			? `${item.etaDias}d`
			: "—";
	const isRisk = item.etaDias >= 15 || item.usd > 100;
	const desc = item.descricao || "";

	const card = document.createElement("div");
	card.className = "card";
	card.setAttribute("role", "button");
	card.setAttribute("tabindex", "0");
	card.setAttribute("aria-label", `Pacote ${item.id}`);
	card.setAttribute("data-testid", `card-${item.id}`);

	card.innerHTML = `
    <div class="card-header">
      <span class="card-id" data-testid="card-id-${item.id}">#${hl(item.id)}</span>
      <div class="card-badges">
        ${item.svc ? `<span class="badge badge-svc">${hl(item.svc)}</span>` : ""}
        ${item.tramo ? `<span class="badge badge-tramo">${hl(item.tramo)}</span>` : ""}
        ${
			item.status && item.status !== "null" && item.status !== ""
				? `<span class="badge badge-status">${hl(item.status)}</span>`
				: ""
		}
        ${isRisk ? `<span class="badge badge-risk">⚠ Risco</span>` : ""}
      </div>
    </div>
    <div class="card-desc ${desc ? "" : "empty"}">${desc ? hl(desc) : "Sem descrição"}</div>
    <div class="card-meta">
      <div class="card-meta-item">
        <span class="card-meta-label">Valor USD</span>
        <span class="card-meta-value usd">${usdStr}</span>
      </div>
      <div class="card-meta-item">
        <span class="card-meta-label">ETA (dias)</span>
        <span class="card-meta-value ${etaClass(item.etaDias)}">${etaStr}</span>
      </div>
      <div class="card-meta-item">
        <span class="card-meta-label">Último Step</span>
        <span class="card-meta-value">${hl(item.ultimoStep || "—")}</span>
      </div>
      <div class="card-meta-item">
        <span class="card-meta-label">Origem</span>
        <span class="card-meta-value">${hl(item.origem || "—")}</span>
      </div>
      ${item.placa ? `<div class="card-meta-item"><span class="card-meta-label">Placa</span><span class="card-meta-value">${hl(item.placa)}</span></div>` : ""}
      ${item.hu ? `<div class="card-meta-item"><span class="card-meta-label">HU</span><span class="card-meta-value" style="font-size:11px">${hl(item.hu)}</span></div>` : ""}
    </div>
    <div class="card-footer">
      <span class="card-date">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        ${formatDate(item.atualizacao)}
      </span>
      <span class="card-click-hint">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Abrir & copiar
      </span>
    </div>`;

	const activate = () => {
		if (!item.id) {
			toast("ID não encontrado.", "error");
			return;
		}
		navigator.clipboard
			.writeText(item.id)
			.then(() => toast(`ID <b>${item.id}</b> copiado!`, "success"))
			.catch(() => {
				try {
					const ta = Object.assign(
						document.createElement("textarea"),
						{
							value: item.id,
							style: "position:fixed;opacity:0",
						},
					);
					document.body.appendChild(ta);
					ta.select();
					document.execCommand("copy");
					ta.remove();
					toast(`ID ${item.id} copiado! (fallback)`, "success");
				} catch (e) {
					toast("Falha ao copiar ID.", "error");
				}
			});
		window.open(
			`https://envios.adminml.com/logistics/package-management/package/${item.id}`,
			"_blank",
			"noopener",
		);
	};
	card.addEventListener("click", activate);
	card.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			activate();
		}
	});
	return card;
}

/* ─── 15. Render principal ───────────────────────────────────────── */
function render() {
	const filtered = getFiltered();
	const sorted = sortItems(filtered);
	const ps = state.pageSize;
	const start = (state.page - 1) * ps;
	const page = sorted.slice(start, start + ps);

	const rc = $("#resultCount");
	if (!allItems.length) {
		rc.innerHTML = "Nenhum item carregado";
		$("#debugToggle").style.display = "none";
	} else {
		rc.innerHTML = `<span>${filtered.length}</span> de ${allItems.length} itens`;
		if (filtered.length !== allItems.length) rc.innerHTML += " (filtrado)";
		$("#debugToggle").style.display = "inline";
	}

	const grid = $("#cardsGrid");
	grid.innerHTML = "";

	/* Aplica classe de view mode */
	if (currentView === "list") {
		grid.classList.add("list-view");
	} else {
		grid.classList.remove("list-view");
	}

	if (!allItems.length) {
		const dz = document.createElement("div");
		dz.id = "dropZone";
		dz.innerHTML = `<div class="drop-icon">📂</div><h3>Nenhum dado carregado</h3><p>Arraste arquivos <b>.csv</b> ou <b>.txt</b> aqui, ou clique em <b>Importar</b>.</p>`;
		setupDropZone(dz);
		grid.appendChild(dz);
	} else if (!filtered.length) {
		const empty = document.createElement("div");
		empty.id = "emptyState";
		empty.innerHTML = `<span class="empty-icon">🔎</span><h3>Nenhum resultado</h3><p>Ajuste os filtros ou o termo de busca.</p>`;
		grid.appendChild(empty);
	} else {
		for (const item of page) grid.appendChild(renderCard(item));
	}

	renderPagination(filtered.length);
	updateChips();
	updateCacheBadge();
}

/* ─── 16. Paginação ─────────────────────────────────────────────── */
function renderPagination(total) {
	const totalPages = Math.ceil(total / state.pageSize);
	const pg = $("#pagination");
	pg.innerHTML = "";
	if (totalPages <= 1) return;

	const btn = (label, page, disabled = false, active = false) => {
		const b = document.createElement("button");
		b.className = "page-btn" + (active ? " active" : "");
		b.disabled = disabled;
		b.innerHTML = label;
		if (!disabled)
			b.addEventListener("click", () => {
				state.page = page;
				render();
				window.scrollTo({ top: 0, behavior: "smooth" });
			});
		return b;
	};

	pg.appendChild(btn("«", 1, state.page === 1));
	pg.appendChild(btn("‹", state.page - 1, state.page === 1));

	const delta = 2;
	const range = [];
	for (
		let i = Math.max(1, state.page - delta);
		i <= Math.min(totalPages, state.page + delta);
		i++
	)
		range.push(i);

	if (range[0] > 1) {
		pg.appendChild(btn("1", 1));
		if (range[0] > 2) {
			const el = document.createElement("span");
			el.textContent = "…";
			el.style.cssText = "padding:0 4px;color:var(--text3)";
			pg.appendChild(el);
		}
	}
	for (const p of range) pg.appendChild(btn(p, p, false, p === state.page));
	if (range[range.length - 1] < totalPages) {
		if (range[range.length - 1] < totalPages - 1) {
			const el = document.createElement("span");
			el.textContent = "…";
			el.style.cssText = "padding:0 4px;color:var(--text3)";
			pg.appendChild(el);
		}
		pg.appendChild(btn(totalPages, totalPages));
	}

	pg.appendChild(btn("›", state.page + 1, state.page === totalPages));
	pg.appendChild(btn("»", totalPages, state.page === totalPages));

	const jw = document.createElement("div");
	jw.id = "pageJumpWrap";
	const ji = document.createElement("input");
	ji.type = "number";
	ji.id = "pageJump";
	ji.min = 1;
	ji.max = totalPages;
	ji.value = state.page;
	ji.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			const p = Math.min(Math.max(1, parseInt(ji.value, 10)), totalPages);
			if (!isNaN(p)) {
				state.page = p;
				render();
				window.scrollTo({ top: 0, behavior: "smooth" });
			}
		}
	});
	jw.appendChild(document.createTextNode("Ir para "));
	jw.appendChild(ji);
	pg.appendChild(jw);
}

/* ─── 17. Drop Zone ──────────────────────────────────────────────── */
function setupDropZone(el) {
	el.addEventListener("dragover", (e) => {
		e.preventDefault();
		el.classList.add("drag-over");
	});
	el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
	el.addEventListener("drop", (e) => {
		e.preventDefault();
		el.classList.remove("drag-over");
		handleFiles(e.dataTransfer.files);
	});
	el.addEventListener("click", () => $("#fileInput").click());
}
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
	e.preventDefault();
	if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

/* ─── 18. Import handler ─────────────────────────────────────────── */
async function handleFiles(files) {
	if (!files || !files.length) return;
	setProgress(10);
	let totalAdded = 0,
		totalMerged = 0;
	const arr = Array.from(files);

	for (let i = 0; i < arr.length; i++) {
		const file = arr[i];
		try {
			const text = await file.text();
			dbg(`Lendo arquivo: ${file.name} (${file.size} bytes)`, "info");
			const parsed = parseFileContent(text, file.name);
			const { added, merged } = ingestItems(parsed);
			totalAdded += added;
			totalMerged += merged;
			dbg(`${file.name}: +${added} novos, ${merged} atualizados`, "ok");
		} catch (e) {
			dbg(`ERRO em ${file.name}: ${e.message}`, "err");
			toast(`Erro ao ler: ${file.name}`, "error");
		}
		setProgress(10 + (i + 1) * (80 / arr.length));
	}

	setProgress(100);
	dbg(`Total em memória: ${allItems.length} itens`, "ok");
	dataSource = "memory";
	await saveItems();
	rebuildChecklists();
	restoreFilterInputs();
	state.page = 1;
	render();

	if (totalAdded === 0 && totalMerged === 0) {
		$("#debugPanel").classList.add("show");
		renderDebug();
		toast(
			`Nenhum item carregado. Veja o painel de debug abaixo.`,
			"warn",
			6000,
		);
	} else {
		toast(
			`${arr.length} arquivo(s): +${totalAdded} novos, ${totalMerged} atualizados.\nTotal: ${allItems.length}`,
			"success",
			5000,
		);
	}
}

/* ─── 19. Restore UI ─────────────────────────────────────────────── */
function restoreFilterInputs() {
	$("#globalSearch").value = state.globalSearch;
	$("#quickSearch").value = state.quickSearch;
	$("#dateFrom").value = state.dateFrom || "";
	$("#dateTo").value = state.dateTo || "";
	$("#usdMin").value = state.usdMin !== null ? state.usdMin : "";
	$("#usdMax").value = state.usdMax !== null ? state.usdMax : "";
	$("#sortSelect").value = state.sort;
	$("#pageSize").value = state.pageSize;
}

/* ═══════════════════════════════════════════════════════════════════
   VIEW TOGGLE — Alterna entre Grid e Lista
   ═══════════════════════════════════════════════════════════════════ */
function setViewMode(mode) {
	currentView = mode;
	localStorage.setItem(VIEW_KEY, mode);

	const gridBtn = $("#gridViewBtn");
	const listBtn = $("#listViewBtn");

	if (mode === "list") {
		gridBtn.classList.remove("active");
		listBtn.classList.add("active");
	} else {
		gridBtn.classList.add("active");
		listBtn.classList.remove("active");
	}

	render();
}

function loadViewMode() {
	const saved = localStorage.getItem(VIEW_KEY);
	if (saved === "list" || saved === "grid") {
		currentView = saved;
	}
	/* Atualiza botões no DOM */
	const gridBtn = $("#gridViewBtn");
	const listBtn = $("#listViewBtn");
	if (currentView === "list") {
		gridBtn.classList.remove("active");
		listBtn.classList.add("active");
	} else {
		gridBtn.classList.add("active");
		listBtn.classList.remove("active");
	}
}

/* ─── 20. Event Listeners ────────────────────────────────────────── */
let _sDebounce, _qDebounce, _usdDebounce;

$("#globalSearch").addEventListener("input", function () {
	clearTimeout(_sDebounce);
	_sDebounce = setTimeout(() => {
		state.globalSearch = this.value.trim();
		state.page = 1;
		saveFilters();
		render();
	}, 280);
});
$("#quickSearch").addEventListener("input", function () {
	clearTimeout(_qDebounce);
	_qDebounce = setTimeout(() => {
		state.quickSearch = this.value.trim();
		state.page = 1;
		saveFilters();
		render();
	}, 280);
});
$("#sortSelect").addEventListener("change", function () {
	state.sort = this.value;
	state.page = 1;
	saveFilters();
	render();
});
$("#pageSize").addEventListener("change", function () {
	state.pageSize = +this.value;
	state.page = 1;
	saveFilters();
	render();
});
$("#dateFrom").addEventListener("change", function () {
	state.dateFrom = this.value || null;
	state.page = 1;
	saveFilters();
	render();
});
$("#dateTo").addEventListener("change", function () {
	state.dateTo = this.value || null;
	state.page = 1;
	saveFilters();
	render();
});
$("#usdMin").addEventListener("input", () => {
	clearTimeout(_usdDebounce);
	_usdDebounce = setTimeout(() => {
		state.usdMin = $("#usdMin").value !== "" ? +$("#usdMin").value : null;
		state.page = 1;
		saveFilters();
		render();
	}, 350);
});
$("#usdMax").addEventListener("input", () => {
	clearTimeout(_usdDebounce);
	_usdDebounce = setTimeout(() => {
		state.usdMax = $("#usdMax").value !== "" ? +$("#usdMax").value : null;
		state.page = 1;
		saveFilters();
		render();
	}, 350);
});

$("#fileInput").addEventListener("change", function () {
	handleFiles(this.files);
	this.value = "";
});

/* Limpar cache — com modal de confirmação */
$("#clearBtn").addEventListener("click", async () => {
	if (!allItems.length) {
		toast("Não há dados para limpar.", "info");
		return;
	}
	const confirmed = await showConfirmModal(
		"Limpar dados",
		`Deseja realmente limpar ${allItems.length} itens e o cache? Esta ação não pode ser desfeita.`,
	);
	if (!confirmed) return;
	await clearItems();
	rebuildChecklists();
	render();
	toast("Dados limpos.", "success");
});

$("#resetFiltersBtn").addEventListener("click", () => {
	state.globalSearch = "";
	state.quickSearch = "";
	state.svcSet.clear();
	state.tramoSet.clear();
	state.statusSet.clear();
	state.dateFrom = null;
	state.dateTo = null;
	state.usdMin = null;
	state.usdMax = null;
	state.sort = "relevance";
	state.page = 1;
	restoreFilterInputs();
	rebuildChecklists();
	saveFilters();
	render();
	toast("Filtros resetados.", "info");
});

/* View toggle listeners */
$("#gridViewBtn").addEventListener("click", () => setViewMode("grid"));
$("#listViewBtn").addEventListener("click", () => setViewMode("list"));

/* Tema */
function applyTheme(t) {
	document.documentElement.setAttribute("data-theme", t);
	const ic = $("#themeIcon");
	ic.innerHTML =
		t === "dark"
			? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
			: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
	localStorage.setItem(THEME_KEY, t);
	dbg(`Tema alterado para: ${t}`, "ok");
}
$("#themeBtn").addEventListener("click", () => {
	const currentTheme = document.documentElement.getAttribute("data-theme");
	const newTheme = currentTheme === "dark" ? "light" : "dark";
	applyTheme(newTheme);
});

/* ─── 21. Init (async para IndexedDB) ───────────────────────────── */
(async function init() {
	dbg("Iniciando PackSearch...", "info");

	// Tenta resolutor de conflito de IndexedDB (limpa se necessário)
	try {
		await openDB();
	} catch (e) {
		dbg(
			`Erro ao abrir IndexedDB na inicialização: ${e.message}. Tentando limpar...`,
			"warn",
		);
		try {
			indexedDB.deleteDatabase(IDB_NAME);
			dbg("Banco de dados antigo deletado. Reconectando...", "info");
			_db = null;
			await openDB();
		} catch (cleanupError) {
			dbg(`Falha ao limpar IndexedDB: ${cleanupError.message}`, "err");
			toast(
				"⚠️ Erro ao inicializar banco de dados. Usando apenas memória.",
				"warn",
			);
		}
	}

	const savedTheme = localStorage.getItem(THEME_KEY) || "light";
	applyTheme(savedTheme);
	loadFilters();
	loadViewMode();
	const hasCache = await loadItems();
	restoreFilterInputs();
	rebuildChecklists();
	render();
	if (hasCache) {
		toast(`Cache restaurado: ${allItems.length} itens.`, "info", 3000);
	} else {
		dbg("Nenhum cache anterior encontrado", "info");
	}
	dbg("PackSearch iniciado com sucesso", "ok");
})();
