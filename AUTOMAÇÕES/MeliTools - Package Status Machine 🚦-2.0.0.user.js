// ==UserScript==
// @name         MeliTools - Package Status Machine 🚦
// @namespace    http://tampermonkey.net/
// @version      2.4.0
// @description  Máquina de Status v2.4: fix detecção de status, novos estados do mock, EnoE por dia, feature flags.
// @author       You
// @match        https://envios.adminml.com/logistics/package-management/package/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
	'use strict';

	const POLL_INTERVAL = 2000;
	const MAX_RETRIES = 30;
	const PANEL_STORAGE_KEY = 'psm-panel-position';
	const PSM_PANEL_ID = 'psm-panel';
	const PSM_MODAL_ID = 'psm-unknown-modal';

	// =============================================
	// FEATURE FLAGS
	// =============================================
	const FLAGS_STORAGE_KEY = 'psm-feature-flags';
	const DEFAULT_FLAGS = {
		coletado_devolucao: { enabled: true, label: 'Coletado → Devolução direta', description: 'Pacotes "Coletado" encaminhados para devolução.' }
	};
	function loadFlags() {
		try {
			const saved = localStorage.getItem(FLAGS_STORAGE_KEY);
			if (!saved) return JSON.parse(JSON.stringify(DEFAULT_FLAGS));
			const parsed = JSON.parse(saved);
			const merged = JSON.parse(JSON.stringify(DEFAULT_FLAGS));
			for (const key of Object.keys(merged)) { if (parsed[key] !== undefined) merged[key].enabled = parsed[key].enabled; }
			return merged;
		} catch { return JSON.parse(JSON.stringify(DEFAULT_FLAGS)); }
	}
	function saveFlags(flags) { try { localStorage.setItem(FLAGS_STORAGE_KEY, JSON.stringify(flags)); } catch { } }
	let FLAGS = loadFlags();

	// =============================================
	// STATE MACHINE
	// =============================================
	const STATES = {
		caminho_para_estacao: {
			id: 'caminho_para_estacao', label: 'Caminho para Estação', icon: '🔄',
			type: 'TRANSIT', color: '#6666CC', bgColor: '#EDEDFF',
			allowedTransitions: ['no_no', 'para_despachar', 'parado_na_estacao', 'problemas_no_no'],
			isTerminal: false, countAsAttempt: false
		},
		no_no: {
			id: 'no_no', label: 'No Nó (Trânsito)', icon: '📍',
			type: 'TRANSIT', color: '#8888AA', bgColor: '#F0F0F8',
			allowedTransitions: ['para_despachar', 'no_no', 'caminho_para_estacao', 'falha_de_entrega', 'em_rota_de_entrega', 'a_caminho_do_destino', 'chegando_ao_destino', 'para_solucao_de_problemas', 'entregue'],
			isTerminal: false, countAsAttempt: false
		},
		para_despachar: {
			id: 'para_despachar', label: 'Para Despachar', icon: '📦',
			type: 'STATION', color: '#0066CC', bgColor: '#E6F0FF',
			allowedTransitions: ['no_carrinho', 'pronto_para_rota', 'em_rota_de_entrega', 'parado_na_estacao', 'buffered', 'para_solucao_de_problemas'],
			isTerminal: false, countAsAttempt: false
		},
		buffered: {
			id: 'buffered', label: 'Buffered', icon: '⏸️',
			type: 'STATION', color: '#7766BB', bgColor: '#F0EDFF',
			allowedTransitions: ['para_despachar', 'no_carrinho'],
			isTerminal: false, countAsAttempt: false
		},
		no_carrinho: {
			id: 'no_carrinho', label: 'No Carrinho', icon: '🛒',
			type: 'STATION', color: '#0088CC', bgColor: '#E6F5FF',
			allowedTransitions: ['pronto_para_rota', 'em_rota_de_entrega', 'para_despachar'],
			isTerminal: false, countAsAttempt: false
		},
		pronto_para_rota: {
			id: 'pronto_para_rota', label: 'Pronto para Rota', icon: '✅',
			type: 'STATION', color: '#00AA44', bgColor: '#E6FFE6',
			allowedTransitions: ['em_rota_de_entrega'],
			isTerminal: false, countAsAttempt: false
		},
		em_rota_de_entrega: {
			id: 'em_rota_de_entrega', label: 'Em Rota de Entrega', icon: '🚚',
			type: 'DELIVERY', color: '#00AA44', bgColor: '#E6FFE6',
			allowedTransitions: ['entregue', 'falha_de_entrega', 'no_no', 'a_caminho_do_destino', 'chegando_ao_destino', 'on_route_at_the_door'],
			isTerminal: false, countAsAttempt: false
		},
		a_caminho_do_destino: {
			id: 'a_caminho_do_destino', label: 'A Caminho do Destino', icon: '🛣️',
			type: 'DELIVERY', color: '#00BB55', bgColor: '#E6FFE6',
			allowedTransitions: ['chegando_ao_destino', 'on_route_at_the_door', 'entregue', 'falha_de_entrega'],
			isTerminal: false, countAsAttempt: false
		},
		chegando_ao_destino: {
			id: 'chegando_ao_destino', label: 'Chegando ao Destino', icon: '📬',
			type: 'DELIVERY', color: '#00CC66', bgColor: '#E6FFE6',
			allowedTransitions: ['on_route_at_the_door', 'entregue', 'falha_de_entrega'],
			isTerminal: false, countAsAttempt: false
		},
		on_route_at_the_door: {
			id: 'on_route_at_the_door', label: 'Na Porta', icon: '🚪',
			type: 'DELIVERY', color: '#00DD77', bgColor: '#E6FFE6',
			allowedTransitions: ['entregue', 'falha_de_entrega'],
			isTerminal: false, countAsAttempt: false
		},
		para_solucao_de_problemas: {
			id: 'para_solucao_de_problemas', label: 'Para Solução de Problemas', icon: '🔧',
			type: 'STATION', color: '#DD6600', bgColor: '#FFF3E0',
			allowedTransitions: ['para_despachar', 'parado_na_estacao', 'para_devolucao', 'para_devolver', 'aguardando_devolucao'],
			isTerminal: false, countAsAttempt: false
		},
		problemas_no_no: {
			id: 'problemas_no_no', label: 'Problemas no Nó', icon: '⚠️',
			type: 'STATION', color: '#DD6600', bgColor: '#FFF3E0',
			allowedTransitions: ['para_solucao_de_problemas', 'para_despachar', 'para_devolucao', 'aguardando_devolucao'],
			isTerminal: false, countAsAttempt: false
		},
		falha_de_entrega: {
			id: 'falha_de_entrega', label: 'Falha de Entrega', icon: '🔴',
			type: 'FAILURE', color: '#FF4444', bgColor: '#FFF0F0',
			allowedTransitions: ['no_no', 'para_despachar', 'parado_na_estacao', 'para_devolucao', 'para_solucao_de_problemas', 'caminho_para_estacao', 'falha_de_entrega'],
			isTerminal: false, countAsAttempt: true
		},
		parado_na_estacao: {
			id: 'parado_na_estacao', label: 'Parado na Estação', icon: '🟡',
			type: 'STATION', color: '#DDAA00', bgColor: '#FFFDE6',
			allowedTransitions: ['para_despachar', 'no_carrinho', 'para_devolucao', 'para_devolver', 'para_solucao_de_problemas'],
			isTerminal: false, countAsAttempt: false
		},
		parado_no_percurso: {
			id: 'parado_no_percurso', label: 'Parado no Percurso', icon: '🔶',
			type: 'TRANSIT', color: '#DD8800', bgColor: '#FFF5E0',
			allowedTransitions: ['caminho_para_estacao', 'para_despachar', 'no_no'],
			isTerminal: false, countAsAttempt: false
		},
		entregue: {
			id: 'entregue', label: 'Entregue', icon: '🎉',
			type: 'TERMINAL', color: '#009933', bgColor: '#E0FFE0',
			allowedTransitions: ['coletado'],
			isTerminal: true, countAsAttempt: false
		},
		coletado: {
			id: 'coletado', label: 'Coletado', icon: '📥',
			type: 'REVERSE', color: '#AA5500', bgColor: '#FFF3E0',
			allowedTransitions: ['no_no', 'para_solucao_de_problemas', 'para_devolucao', 'para_despachar', 'para_devolver'],
			isTerminal: false, countAsAttempt: false
		},
		aguardando_devolucao: {
			id: 'aguardando_devolucao', label: 'Aguardando Devolução', icon: '⏳',
			type: 'TERMINAL', color: '#9900CC', bgColor: '#F5E6FF',
			allowedTransitions: ['para_devolucao', 'devolvido', 'para_devolver'],
			isTerminal: false, countAsAttempt: false
		},
		para_devolucao: {
			id: 'para_devolucao', label: 'Para Devolução', icon: '🔙',
			type: 'TERMINAL', color: '#9900CC', bgColor: '#F5E6FF',
			allowedTransitions: ['devolvido', 'aguardando_devolucao', 'para_devolver'],
			isTerminal: false, countAsAttempt: false
		},
		para_devolver: {
			id: 'para_devolver', label: 'Para Devolver', icon: '↩️',
			type: 'TERMINAL', color: '#9900CC', bgColor: '#F5E6FF',
			allowedTransitions: ['devolvido', 'entregue'],
			isTerminal: false, countAsAttempt: false
		},
		devolvido: {
			id: 'devolvido', label: 'Devolvido', icon: '📨',
			type: 'TERMINAL', color: '#9900CC', bgColor: '#F5E6FF',
			allowedTransitions: [], isTerminal: true, countAsAttempt: false
		},
		cancelado: {
			id: 'cancelado', label: 'Cancelado', icon: '⛔',
			type: 'TERMINAL', color: '#CC0000', bgColor: '#FFE0E0',
			allowedTransitions: [], isTerminal: true, countAsAttempt: false
		},
		extraviado: {
			id: 'extraviado', label: 'Extraviado', icon: '🚨',
			type: 'TERMINAL', color: '#CC0000', bgColor: '#FFE0E0',
			allowedTransitions: [], isTerminal: true, countAsAttempt: false
		},
		in_transit: {
			id: 'in_transit', label: 'Em Trânsito (Genérico)', icon: '🔀',
			type: 'TRANSIT', color: '#888888', bgColor: '#F5F5F5',
			allowedTransitions: ['no_no', 'caminho_para_estacao', 'para_despachar'],
			isTerminal: false, countAsAttempt: false
		},
		_unknown: {
			id: '_unknown', label: 'Desconhecido', icon: '❓',
			type: 'UNKNOWN', color: '#999999', bgColor: '#F5F5F5',
			allowedTransitions: [], isTerminal: false, countAsAttempt: false
		}
	};

	// =============================================
	// FAILURE CLASSES
	// =============================================
	const FAILURE_CLASSES = {
		countable: {
			patterns: [
				'não havia ninguém', 'cliente ausente', 'destinatário ausente',
				'não atendeu', 'portão fechado', 'erro de endereço',
				'endereço não localizado', 'endereço incompleto', 'endereço incorreto',
				'caixa postal', 'área de risco', 'pacote de outra área',
				'dificuldade de acesso', 'faltante', 'área inacessível',
				'negócio fechado'
			],
			label: 'Tentativa Contável', icon: '🔴'
		},
		refusal: {
			patterns: [
				'recusado pelo cliente', 'recusado pelo comprador',
				'recusado pelo destinatário', 'cliente recusou',
				'recusa do destinatário', 'recusado'
			],
			label: 'Recusa (Devolução Imediata)', icon: '⛔'
		},
		nonCountable: {
			patterns: [
				'atraso operacional', 'problema no veículo',
				'condição climática', 'feriado', 'greve'
			],
			label: 'Operacional (Não Contável)', icon: 'ℹ️'
		}
	};

	const RETURN_POLICY = { maxAttempts: 3 };

	// =============================================
	// STATUS DETECTION RULES — Ordenadas por prioridade
	// =============================================
	// Regras mais específicas primeiro, genéricas depois.
	// Cada regra: { test: (lower) => bool, stateId: string, extractSub?: (raw) => string|null }
	const STATUS_RULES = [
		// Trânsito com nó
		{
			test: (l) => l.includes('no nó') && l.includes('transita por'),
			stateId: 'no_no',
			isTransit: true
		},
		// Problemas no nó (antes de "no nó" genérico)
		{
			test: (l) => l.includes('problemas no nó'),
			stateId: 'problemas_no_no',
			extractSub: (raw) => {
				const m = raw.match(/Problemas no nó\s*\|\s*(.+?)(?:\s*\||\s*Ver|\s*$)/i);
				return m ? m[1].trim() : null;
			}
		},
		// Falha de entrega (com sub-status)
		{
			test: (l) => l.includes('falha de entrega'),
			stateId: 'falha_de_entrega',
			extractSub: (raw) => {
				const m = raw.match(/Falha de entrega\s*\|\s*(.+?)(?:\s*Ruta|\s*Ver|\s*$)/i);
				return m ? m[1].trim() : null;
			}
		},
		// Para solução de problemas (com possível sub-status)
		{
			test: (l) => l.includes('para solução de problemas') || l.includes('para solu'),
			stateId: 'para_solucao_de_problemas',
			extractSub: (raw) => {
				const m = raw.match(/Para solu[çc][aã]o de problemas\s*\|\s*(.+?)(?:\s*\||\s*Ruta|\s*Ver|\s*$)/i);
				return m ? m[1].trim() : null;
			}
		},
		// Para devolver (ANTES de "para devolução" pois "devolver" != "devolução")
		{
			test: (l) => l.includes('para devolver'),
			stateId: 'para_devolver'
		},
		// Para devolução (com possível sub-status)
		{
			test: (l) => l.includes('para devolução') || l.includes('para devolu'),
			stateId: 'para_devolucao',
			extractSub: (raw) => {
				const m = raw.match(/Para devolu[çc][aã]o\s*\|\s*(.+?)(?:\s*Ruta|\s*Ver|\s*$)/i);
				return m ? m[1].trim() : null;
			}
		},
		// Aguardando devolução
		{
			test: (l) => l.includes('aguardando devolu'),
			stateId: 'aguardando_devolucao'
		},
		// Bulky coletado (ANTES de coletado genérico)
		{
			test: (l) => l.includes('bulky coletado'),
			stateId: 'coletado'
		},
		// Coletado (genérico — "Coletado |" ou "Coletado" isolado)
		{
			test: (l) => /\bcoletado\b/.test(l) && !l.includes('bulky'),
			stateId: 'coletado'
		},
		// Buffered
		{
			test: (l) => /\bbuffered\b/.test(l),
			stateId: 'buffered'
		},
		// on_route at_the_door
		{
			test: (l) => l.includes('on_route') && l.includes('at_the_door'),
			stateId: 'on_route_at_the_door'
		},
		// Chegando ao destino
		{ test: (l) => l.includes('chegando ao destino'), stateId: 'chegando_ao_destino' },
		// A caminho do destino
		{ test: (l) => l.includes('a caminho do destino'), stateId: 'a_caminho_do_destino' },
		// Em rota de entrega
		{ test: (l) => l.includes('em rota de entrega'), stateId: 'em_rota_de_entrega' },
		// Pronto para a rota
		{ test: (l) => l.includes('pronto para a rota'), stateId: 'pronto_para_rota' },
		// No carrinho
		{ test: (l) => l.includes('no carrinho'), stateId: 'no_carrinho' },
		// Para despachar
		{ test: (l) => l.includes('para despachar'), stateId: 'para_despachar' },
		// Parado no percurso (ANTES de "parado na estação")
		{ test: (l) => l.includes('parado no percurso'), stateId: 'parado_no_percurso' },
		// Parado na estação
		{ test: (l) => l.includes('parado na esta'), stateId: 'parado_na_estacao' },
		// Caminho para a estação
		{ test: (l) => l.includes('caminho para a esta'), stateId: 'caminho_para_estacao' },
		// Entregue (pega "Entregue", "Entregue - Place", etc.)
		{ test: (l) => /\bentregue\b/.test(l), stateId: 'entregue' },
		// Devolvido
		{ test: (l) => /\bdevolvido\b/.test(l), stateId: 'devolvido' },
		// Cancelado
		{ test: (l) => /\bcancelado\b/.test(l), stateId: 'cancelado' },
		// Extraviado
		{ test: (l) => /\bextraviado\b/.test(l), stateId: 'extraviado' },
		// in_transit (raw text do sistema)
		{ test: (l) => /\bin_transit\b/.test(l), stateId: 'in_transit' }
	];

	// =============================================
	// TOKENIZER
	// =============================================
	function tokenizeHistory(rawEntries) {
		const tokens = [], seen = new Set();
		for (const entry of rawEntries) {
			const text = entry.textContent?.trim() || '';
			if (!text) continue;
			const token = parseLine(text, tokens.length);
			const key = `${token.datetime}|${token.stateId}|${token.subStatus || ''}|${token.route || ''}`;
			if (seen.has(key)) continue;
			seen.add(key);
			tokens.push(token);
		}
		return tokens;
	}

	function parseLine(raw, index) {
		const MONTHS = { jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06', jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12' };
		const dateMatch = raw.match(/(\d{2})\/(\w{3})\s+(\d{2}:\d{2})\s*hs/);

		let datetime = null, dateISO = null, dayKey = null;
		if (dateMatch) {
			const [, day, monthStr, time] = dateMatch;
			datetime = `${day}/${monthStr} ${time}`;
			dateISO = `${new Date().getFullYear()}-${MONTHS[monthStr.toLowerCase()] || '01'}-${day}T${time}:00`;
			dayKey = `${day}/${monthStr}`;
		}

		const lower = raw.toLowerCase();
		let stateId = null, subStatus = null, isTransit = false;
		let facility = null, route = null;
		let hasViewUpdate = lower.includes('ver atualiza');
		let rawStatusText = null;

		// Extrair status text bruto
		const afterPipe = raw.match(/hs\s*\|\s*(.+)/);
		if (afterPipe) {
			rawStatusText = afterPipe[1]
				.replace(/Ver atualização/gi, '').replace(/Ruta\s+\d+/gi, '')
				.replace(/Transita por\s+.+/gi, '').replace(/\|/g, ' ').trim();
		}

		// Aplicar regras de detecção em ordem
		for (const rule of STATUS_RULES) {
			if (rule.test(lower)) {
				stateId = rule.stateId;
				isTransit = rule.isTransit || false;
				if (rule.extractSub) subStatus = rule.extractSub(raw);

				// Facility para no_no
				if (stateId === 'no_no') {
					const fm = raw.match(/Transita por\s+(.+?)(?:\s*Ver|\s*$)/i);
					if (fm) facility = fm[1].trim();
				}
				// Facility para problemas_no_no
				if (stateId === 'problemas_no_no') {
					const fm = raw.match(/Problemas no nó\s*\|[^|]*\|\s*(\S+)/i);
					if (fm) facility = fm[1].trim();
				}
				break;
			}
		}

		// Route
		const rm = raw.match(/Ruta\s+(\d+)/i);
		if (rm) route = rm[1];

		// Facility fallback
		if (!facility) {
			const fm = raw.match(/(SERVICE_CENTER\s+\w+|NEX\s+\w+|XPT\s+\w+)/i);
			if (fm) facility = fm[1].trim();
		}
		// Limpar lixo do facility
		if (facility) facility = facility.replace(/\s*\d{2}\/\w{3}\s+\d{2}:\d{2}.*$/, '').replace(/\s*📋.*$/, '').replace(/\s*🚦.*$/, '').trim();

		const state = STATES[stateId] || STATES._unknown;
		const isUnknown = !stateId;

		return { index, datetime, dateISO, dayKey, stateId: stateId || '_unknown', state, subStatus, isTransit, facility, route, hasViewUpdate, raw, rawStatusText, isUnknown };
	}

	// =============================================
	// UNKNOWN DETECTOR
	// =============================================
	function collectUnknowns(tokens) {
		const unknowns = [], seen = new Set();
		for (const t of tokens) {
			if (t.isUnknown && t.rawStatusText) {
				const key = t.rawStatusText.toLowerCase().substring(0, 50).trim();
				if (!seen.has(key)) { seen.add(key); unknowns.push({ rawText: t.rawStatusText, fullRaw: t.raw, datetime: t.datetime, index: t.index }); }
			}
		}
		return unknowns;
	}

	// =============================================
	// FAILURE CLASSIFIER
	// =============================================
	function classifyFailure(subStatus) {
		if (!subStatus) return { class: 'countable', ...FAILURE_CLASSES.countable };
		const lower = subStatus.toLowerCase();
		for (const [cls, config] of Object.entries(FAILURE_CLASSES)) {
			if (config.patterns.some(p => lower.includes(p))) return { class: cls, ...config };
		}
		return { class: 'countable', ...FAILURE_CLASSES.countable };
	}

	// =============================================
	// EnoE COUNTER — por DIA
	// =============================================
	function countAttempts(tokens) {
		let immediateReturn = false, immediateReason = null;
		const rawFailures = [];

		for (const t of tokens) {
			if (t.stateId !== 'falha_de_entrega') continue;
			const classification = classifyFailure(t.subStatus);
			if (classification.class === 'refusal') {
				immediateReturn = true; immediateReason = t.subStatus || 'Recusado';
				rawFailures.push({ date: t.datetime, dayKey: t.dayKey, reason: t.subStatus || 'Recusado', route: t.route, classification, facility: t.facility, isRefusal: true });
				continue;
			}
			if (classification.class === 'nonCountable') continue;
			rawFailures.push({ date: t.datetime, dayKey: t.dayKey, reason: t.subStatus || 'Motivo não especificado', route: t.route, classification, facility: t.facility, isRefusal: false });
		}

		const dayMap = new Map();
		for (const f of rawFailures) {
			if (!f.dayKey) continue;
			if (!dayMap.has(f.dayKey)) dayMap.set(f.dayKey, { dayKey: f.dayKey, date: f.date, route: f.route, facility: f.facility, failures: [], hasRefusal: false });
			const day = dayMap.get(f.dayKey);
			day.failures.push(f);
			if (f.isRefusal) day.hasRefusal = true;
		}

		const attempts = [];
		for (const [, day] of dayMap) {
			attempts.push({
				dayKey: day.dayKey, date: day.date, route: day.route, facility: day.facility,
				reason: day.failures.map(f => f.reason).join(' + '),
				failureCount: day.failures.length, failures: day.failures,
				classification: day.hasRefusal ? { class: 'refusal', ...FAILURE_CLASSES.refusal } : day.failures[0]?.classification || { class: 'countable', ...FAILURE_CLASSES.countable },
				hasRefusal: day.hasRefusal
			});
		}
		attempts.sort((a, b) => (a.date && b.date) ? (a.date < b.date ? 1 : -1) : 0);

		const count = attempts.length;
		const shouldReturn = immediateReturn || count >= RETURN_POLICY.maxAttempts;
		const remaining = Math.max(0, RETURN_POLICY.maxAttempts - count);
		return { attempts, rawFailures, count, remaining, shouldReturn, immediateReturn, immediateReason, progressPct: Math.min(100, (count / RETURN_POLICY.maxAttempts) * 100) };
	}

	function detectColetado(tokens) {
		return { hasColetado: tokens.some(t => t.stateId === 'coletado'), hadDelivery: tokens.some(t => t.stateId === 'entregue') };
	}

	// =============================================
	// TRANSITION VALIDATOR
	// =============================================
	function validateTransitions(tokens) {
		const anomalies = [];
		for (let i = 0; i < tokens.length - 1; i++) {
			const current = tokens[i], previous = tokens[i + 1];
			if (previous.stateId === '_unknown' || current.stateId === '_unknown') continue;
			const prevState = STATES[previous.stateId];
			if (prevState && prevState.allowedTransitions.length > 0 && !prevState.allowedTransitions.includes(current.stateId)) {
				anomalies.push({ from: previous, to: current, message: `${previous.state.icon} ${previous.state.label} → ${current.state.icon} ${current.state.label}` });
			}
		}
		return anomalies;
	}

	// =============================================
	// DWELL / PROMISE
	// =============================================
	function calculateDwell(tokens) {
		const MONTHS = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
		const now = new Date(), year = now.getFullYear();
		const parsed = tokens.filter(t => t.datetime).map(t => {
			const [dm, time] = t.datetime.split(' '), [d, ms] = dm.split('/'), [h, m] = time.split(':');
			return { ...t, date: new Date(year, MONTHS[ms.toLowerCase()] ?? 0, +d, +h, +m) };
		});
		if (!parsed.length) return null;
		const dwellMs = now - parsed[0].date, totalMs = now - parsed[parsed.length - 1].date;
		const fmt = (ms) => { const h = Math.floor(ms / 3600000), d = Math.floor(h / 24); return d > 0 ? `${d}d ${h % 24}h` : `${h}h`; };
		return { sinceLastUpdate: fmt(dwellMs), totalJourney: fmt(totalMs), isStale: dwellMs > 24 * 3600000, isVeryStale: dwellMs > 48 * 3600000 };
	}

	function checkPromise() {
		const body = document.body.innerText;
		const pm = body.match(/Promessa de entrega\s*([\d\/\w\s\-]+?)(?:\s*Cancelar)/i);
		if (!pm) return null;
		const MONTHS = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
		const now = new Date(), year = now.getFullYear(), raw = pm[1].trim();
		const parts = raw.split('-').map(s => s.trim()), last = parts[parts.length - 1];
		const dm = last.match(/(\d{2})\/(\w{3})/);
		if (!dm) return null;
		const endDate = new Date(year, MONTHS[dm[2].toLowerCase()] ?? 0, +dm[1], 23, 59, 59);
		const isOverdue = now > endDate, daysOverdue = isOverdue ? Math.floor((now - endDate) / 86400000) : 0;
		return { raw, endDate, isOverdue, daysOverdue };
	}

	// =============================================
	// DECISION ENGINE
	// =============================================
	function decide(tokens, enoe, promise, dwell) {
		const cur = tokens[0];
		if (!cur) return { tag: '?', action: '❓ Sem dados.', priority: 'UNKNOWN', color: '#999' };
		const sid = cur.stateId, hasF = enoe.count > 0, pOver = promise?.isOverdue;
		const col = detectColetado(tokens);

		// Coletado → Devolução (flag)
		if (col.hasColetado && FLAGS.coletado_devolucao.enabled) {
			const isCur = sid === 'coletado';
			return {
				tag: 'DEVOLUÇÃO', priority: 'CRITICAL', color: '#AA5500',
				action: `📥 COLETADO → DEVOLUÇÃO DIRETA${col.hadDelivery ? ' (pós-entrega)' : ''}.\n\n${isCur ? '→ Status ATUAL é "Coletado".' : '→ Pacote passou por "Coletado".'}\n→ Encaminhar para devolução imediata.\n\n⚙️ Regra "Coletado → Devolução" ATIVA.`
			};
		}

		if (sid === 'entregue') return { tag: 'CONCLUÍDO', priority: 'NONE', color: '#009933', action: '✅ Entregue. Nenhuma ação.' };
		if (sid === 'devolvido') return { tag: 'DEVOLVIDO', priority: 'NONE', color: '#9900CC', action: '📨 Devolvido. Encerrado.' };
		if (sid === 'cancelado') return { tag: 'CANCELADO', priority: 'NONE', color: '#CC0000', action: '⛔ Cancelado.' };
		if (sid === 'extraviado') return { tag: 'EXTRAVIADO', priority: 'CRITICAL', color: '#CC0000', action: '🚨 Extraviado. Escalar.' };
		if (sid === 'aguardando_devolucao') return { tag: 'DEVOLUÇÃO', priority: 'MEDIUM', color: '#9900CC', action: '⏳ AGUARDANDO DEVOLUÇÃO — Monitorar.' };
		if (sid === 'para_devolver') return { tag: 'DEVOLUÇÃO', priority: 'MEDIUM', color: '#9900CC', action: '↩️ PARA DEVOLVER — Pacote no fluxo de devolução ativa.' };

		if (enoe.immediateReturn) return { tag: 'DEVOLUÇÃO', priority: 'CRITICAL', color: '#CC0000', action: `⛔ DEVOLUÇÃO IMEDIATA — Recusa ("${enoe.immediateReason}").\n\n→ Alterar para "Para Devolução".` };
		if (enoe.shouldReturn) return { tag: 'DEVOLUÇÃO', priority: 'CRITICAL', color: '#9900CC', action: `🔙 DEVOLUÇÃO (EnoE) — ${enoe.count}/${RETURN_POLICY.maxAttempts} dias esgotados.\n\n→ Encaminhar para devolução.\n→ Se "não marcado", alterar manualmente.` };

		if (sid === 'coletado') return { tag: 'COLETADO', priority: 'HIGH', color: '#AA5500', action: `📥 COLETADO${col.hadDelivery ? ' (pós-entrega)' : ''}.\n\n→ Verificar motivo.\n⚙️ Regra "Coletado → Devolução" DESATIVADA.` };

		if (['em_rota_de_entrega', 'a_caminho_do_destino', 'chegando_ao_destino', 'on_route_at_the_door'].includes(sid)) {
			return { tag: 'EM ROTA', priority: 'LOW', color: '#00AA44', action: `🚚 ${cur.state.label.toUpperCase()}${cur.route ? ` (Ruta ${cur.route})` : ''}\n${hasF ? `⚠️ Dia ${enoe.count + 1}/${RETURN_POLICY.maxAttempts}.` : 'Primeiro dia.'} Monitorar.` };
		}

		if (sid === 'falha_de_entrega') return { tag: 'FALHA', priority: 'HIGH', color: '#FF4444', action: `🔴 FALHA — "${cur.subStatus || '?'}".\nDias: ${enoe.count}/${RETURN_POLICY.maxAttempts}. Restam ${enoe.remaining}.\n\n→ Aguardar retorno.${enoe.remaining === 1 ? '\n⚠️ Próxima = DEVOLUÇÃO!' : ''}` };

		if (sid === 'para_solucao_de_problemas') {
			const sub = cur.subStatus ? `\n📋 Motivo: "${cur.subStatus}"` : '';
			return { tag: 'PROBLEMA', priority: 'HIGH', color: '#DD6600', action: `🔧 PARA SOLUÇÃO DE PROBLEMAS.${sub}\n${hasF ? `📊 Dias: ${enoe.count}/${RETURN_POLICY.maxAttempts}.` : ''}\n\n→ Verificar e resolver.` };
		}

		if (sid === 'problemas_no_no') {
			const sub = cur.subStatus ? `\n📋 "${cur.subStatus}"` : '';
			return { tag: 'PROBLEMA', priority: 'HIGH', color: '#DD6600', action: `⚠️ PROBLEMAS NO NÓ — Pacote com problema no trânsito.${sub}\n\n→ Verificar destino correto e resolver.` };
		}

		if (sid === 'parado_na_estacao') {
			return { tag: 'STALE', priority: 'HIGH', color: '#DDAA00', action: `🟡 PARADO${dwell ? ` há ${dwell.sinceLastUpdate}` : ''}.${hasF ? `\n📊 Dias: ${enoe.count}/${RETURN_POLICY.maxAttempts}.` : ''}${pOver ? `\n⚠️ SLA VENCIDO há ${promise.daysOverdue}d!` : ''}\n\n→ Verificar e re-roteirizar ou escalar.` };
		}

		if (sid === 'parado_no_percurso') {
			return { tag: 'PARADO', priority: 'HIGH', color: '#DD8800', action: `🔶 PARADO NO PERCURSO${dwell ? ` há ${dwell.sinceLastUpdate}` : ''}.${pOver ? `\n⚠️ SLA VENCIDO há ${promise.daysOverdue}d!` : ''}\n\n→ Pacote parado em trânsito. Escalar se prolongado.` };
		}

		if (sid === 'para_despachar' && hasF) {
			const lf = enoe.attempts[0];
			return { tag: enoe.remaining === 1 ? 'ÚLTIMA CHANCE' : 'RETREATMENT', priority: enoe.remaining === 1 ? 'CRITICAL' : 'HIGH', color: enoe.remaining === 1 ? '#FF4444' : '#FF6600', action: `🔴 RETREATMENT — ${enoe.count}/${RETURN_POLICY.maxAttempts} dia(s). Restam ${enoe.remaining}.\nÚltimo: ${lf?.dayKey || '?'} → "${lf?.reason || 'N/A'}"\n\n→ Verificar endereço e re-roteirizar.${enoe.remaining === 1 ? '\n🚨 ÚLTIMA!' : ''}${pOver ? `\n⚠️ SLA vencido ${promise.daysOverdue}d!` : ''}` };
		}

		if (sid === 'para_despachar') return { tag: 'DESPACHO', priority: pOver ? 'HIGH' : 'MEDIUM', color: '#0066CC', action: `📦 DESPACHAR${cur.facility ? ` (${cur.facility})` : ''}.${pOver ? `\n⚠️ SLA vencido!` : ''}` };
		if (sid === 'buffered') return { tag: 'BUFFERED', priority: 'MEDIUM', color: '#7766BB', action: `⏸️ BUFFERED — Pacote em buffer aguardando processamento.\n\n→ Será despachado automaticamente ou verificar manualmente.` };
		if (sid === 'no_carrinho') return { tag: 'AGUARDAR', priority: 'LOW', color: '#0088CC', action: '🛒 NO CARRINHO — Aguardar saída.' };
		if (sid === 'pronto_para_rota') return { tag: 'PRONTO', priority: 'LOW', color: '#00AA44', action: '✅ PRONTO PARA ROTA.' };
		if (['caminho_para_estacao', 'in_transit', 'no_no'].includes(sid)) return { tag: 'TRÂNSITO', priority: 'LOW', color: '#6666CC', action: `🔄 EM TRÂNSITO${cur.facility ? ` — ${cur.facility}` : ''}.` };
		if (sid === 'para_devolucao') {
			const sub = cur.subStatus ? `\n📋 Motivo: "${cur.subStatus}"` : '';
			return { tag: 'DEVOLUÇÃO', priority: 'MEDIUM', color: '#9900CC', action: `🔙 Para devolução. Seguir fluxo.${sub}` };
		}

		return { tag: 'MANUAL', priority: 'UNKNOWN', color: '#999', action: `ℹ️ "${cur.state.label}". Verificar manualmente.` };
	}

	// =============================================
	// SCRAPER
	// =============================================
	function scrapeHistory() {
		const lines = document.body.innerText.split('\n');
		const dateRx = /\d{2}\/\w{3}\s+\d{2}:\d{2}\s*hs/;
		let inHistory = false, buffer = '';
		const entries = [];
		const JUNK = ['Status Machine', 'TENTATIVAS ENOE', 'Tokenizer ativo', 'MeliTools —', 'AÇÃO RECOMENDADA', 'TRANSIÇÕES ANÔMALAS', 'MAPA DE ESTADOS', 'ÚLTIMO UPDATE', 'JORNADA TOTAL'];

		for (const line of lines) {
			const t = line.trim();
			if (!t) continue;
			if (t.includes('Histórico do pacote') || t.includes('Atualizações de status')) { inHistory = true; continue; }
			if (t.includes('A mudança de estado pode ser refletida')) continue;
			if (!inHistory) continue;
			if (t.includes('Status Machine') && t.includes('MeliTools')) break;
			if (JUNK.some(j => t.includes(j))) {
				if (buffer) { const c = cleanBuffer(buffer, dateRx); if (c) entries.push({ textContent: c }); buffer = ''; }
				continue;
			}

			if (dateRx.test(t)) {
				if (buffer) { const c = cleanBuffer(buffer, dateRx); if (c) entries.push({ textContent: c }); }
				buffer = t;
			} else if (buffer && t) { buffer += ' ' + t; }
		}
		if (buffer) { const c = cleanBuffer(buffer, dateRx); if (c) entries.push({ textContent: c }); }
		return entries;
	}

	function cleanBuffer(buf, dateRx) {
		const JUNK_PATTERNS = [/📋\s*Tokenizer ativo.*/i, /🚦\s*Status Machine.*/i, /MeliTools\s*—.*/i, /⚠️\s*Status Desconhecido.*/i, /ADICIONE AO STATES.*/i];
		let cleaned = buf;
		for (const p of JUNK_PATTERNS) cleaned = cleaned.replace(p, '');
		cleaned = cleaned.trim();
		return (cleaned && dateRx.test(cleaned)) ? cleaned : null;
	}

	function getPackageId() { return window.location.pathname.match(/package\/(\d+)/)?.[1] || 'N/A'; }

	// =============================================
	// DRAGGABLE
	// =============================================
	function loadPosition() { try { return JSON.parse(localStorage.getItem(PANEL_STORAGE_KEY)); } catch { return null; } }
	function savePosition(x, y) { try { localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify({ x, y })); } catch { } }
	function makeDraggable(panel, handle) {
		let dragging = false, sx, sy, sl, st;
		handle.style.cursor = 'grab';
		handle.addEventListener('mousedown', (e) => {
			if (e.target.closest('.psm-btn')) return;
			dragging = true; handle.style.cursor = 'grabbing';
			sx = e.clientX; sy = e.clientY;
			const r = panel.getBoundingClientRect(); sl = r.left; st = r.top; e.preventDefault();
		});
		document.addEventListener('mousemove', (e) => {
			if (!dragging) return;
			let nl = Math.max(0, Math.min(sl + e.clientX - sx, innerWidth - panel.offsetWidth));
			let nt = Math.max(0, Math.min(st + e.clientY - sy, innerHeight - panel.offsetHeight));
			panel.style.left = nl + 'px'; panel.style.top = nt + 'px'; panel.style.right = 'auto';
		});
		document.addEventListener('mouseup', () => { if (!dragging) return; dragging = false; handle.style.cursor = 'grab'; savePosition(parseInt(panel.style.left), parseInt(panel.style.top)); });
	}

	// =============================================
	// UNKNOWN MODAL
	// =============================================
	function showUnknownModal(unknowns, packageId) {
		const existing = document.getElementById(PSM_MODAL_ID); if (existing) existing.remove();
		const codeBlock = unknowns.map(u => {
			const sid = u.rawText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_').substring(0, 40);
			return `    ${sid}: {\n        id: '${sid}', label: '${u.rawText}', icon: '❓',\n        type: '???', color: '#999999', bgColor: '#F5F5F5',\n        allowedTransitions: [], isTerminal: false, countAsAttempt: false\n    }`;
		}).join(',\n\n');

		const modal = document.createElement('div'); modal.id = PSM_MODAL_ID;
		modal.innerHTML = `<style>#${PSM_MODAL_ID}{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}.psm-mo-overlay{position:absolute;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px)}.psm-mo-card{position:relative;background:#fff;border-radius:16px;width:580px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,.3);overflow:hidden;animation:psmMIn .25s ease}@keyframes psmMIn{from{transform:scale(.92) translateY(20px);opacity:0}to{transform:scale(1) translateY(0);opacity:1}}.psm-mo-hdr{background:linear-gradient(135deg,#FF6B00,#FF4444);color:#fff;padding:20px 24px;display:flex;justify-content:space-between;align-items:flex-start}.psm-mo-hdr h2{margin:0;font-size:16px;font-weight:700}.psm-mo-hdr p{margin:4px 0 0;font-size:12px;opacity:.85}.psm-mo-close{background:rgba(255,255,255,.2);border:none;color:#fff;cursor:pointer;border-radius:50%;width:32px;height:32px;font-size:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0}.psm-mo-body{padding:20px 24px;overflow-y:auto;flex:1;scrollbar-width:none;-ms-overflow-style:none}.psm-mo-body::-webkit-scrollbar{display:none}.psm-mo-item{background:#FFF8F0;border:1px solid #FFCC80;border-left:4px solid #FF6B00;border-radius:8px;padding:12px 14px;margin-bottom:10px}.psm-mo-status{font-size:15px;font-weight:700;color:#E65100;margin-bottom:4px}.psm-mo-raw{font-size:11px;color:#888;font-family:'Courier New',monospace;word-break:break-all}.psm-mo-date{font-size:10px;color:#aaa;margin-top:2px}.psm-mo-code{background:#111827;color:#00FF88;border-radius:10px;padding:16px;font-family:'Courier New',monospace;font-size:12px;line-height:1.6;white-space:pre;overflow:auto;border:1px solid #1f2937;max-height:280px;scrollbar-width:none;-ms-overflow-style:none}.psm-mo-code::-webkit-scrollbar{display:none}.psm-mo-ft{padding:14px 24px;background:#f8f9fa;border-top:1px solid #eee;display:flex;justify-content:flex-end;gap:8px}.psm-mo-btn{padding:8px 20px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none}.psm-mo-ghost{background:#e5e7eb;color:#555}.psm-mo-primary{background:#FF6B00;color:#fff}</style>
        <div class="psm-mo-overlay" id="psm-mo-overlay"></div><div class="psm-mo-card"><div class="psm-mo-hdr"><div><h2>⚠️ Status Desconhecido</h2><p>📦 ${packageId} · ${unknowns.length} não mapeado(s)</p></div><button class="psm-mo-close" id="psm-mo-close">×</button></div><div class="psm-mo-body">${unknowns.map(u => `<div class="psm-mo-item"><div class="psm-mo-status">❓ "${u.rawText}"</div><div class="psm-mo-raw">${u.fullRaw?.substring(0, 160)}</div><div class="psm-mo-date">📅 ${u.datetime || '?'} · #${u.index}</div></div>`).join('')}<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#888;font-weight:600;margin:12px 0 6px">📋 Adicione ao STATES:</div><div class="psm-mo-code" id="psm-mo-code">${codeBlock}</div></div><div class="psm-mo-ft"><button class="psm-mo-btn psm-mo-ghost" id="psm-mo-dismiss">Ignorar</button><button class="psm-mo-btn psm-mo-primary" id="psm-mo-copy">📋 Copiar</button></div></div>`;
		document.body.appendChild(modal);
		const close = () => { modal.style.opacity = '0'; setTimeout(() => modal.remove(), 200); };
		document.getElementById('psm-mo-close').onclick = close;
		document.getElementById('psm-mo-overlay').onclick = close;
		document.getElementById('psm-mo-dismiss').onclick = close;
		document.getElementById('psm-mo-copy').onclick = async () => {
			const code = document.getElementById('psm-mo-code').textContent;
			try { await navigator.clipboard.writeText(code); } catch { const ta = document.createElement('textarea'); ta.value = code; ta.style.cssText = 'position:fixed;top:-9999px'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
			const b = document.getElementById('psm-mo-copy'); b.textContent = '✅ Copiado!'; b.style.background = '#009933'; setTimeout(() => { b.textContent = '📋 Copiar'; b.style.background = ''; }, 2000);
		};
		document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
	}

	// =============================================
	// RENDERER
	// =============================================
	function render(tokens, decision, dwell, enoe, promise, anomalies, packageId) {
		const old = document.getElementById(PSM_PANEL_ID); if (old) old.remove();
		const cur = tokens[0], st = cur?.state || STATES._unknown, pos = loadPosition();

		const dots = [];
		for (let i = 0; i < RETURN_POLICY.maxAttempts; i++) {
			const a = enoe.attempts[i];
			if (a) { const c = a.hasRefusal ? '#CC0000' : '#FF4444'; dots.push(`<div class="psm-dot filled" style="background:${c}" title="${a.dayKey}: ${a.reason} (${a.failureCount})"><span>${i + 1}</span></div>`); }
			else dots.push(`<div class="psm-dot empty"><span>${i + 1}</span></div>`);
			if (i < RETURN_POLICY.maxAttempts - 1) dots.push(`<div class="psm-conn ${i < enoe.count - 1 ? 'active' : ''}"></div>`);
		}

		const flagsHtml = Object.entries(FLAGS).map(([k, f]) => `<label class="psm-flag" title="${f.description}"><input type="checkbox" data-flag="${k}" ${f.enabled ? 'checked' : ''}/><span class="psm-flag-slider"></span><span class="psm-flag-label">${f.label}</span><span class="psm-flag-status">${f.enabled ? 'ON' : 'OFF'}</span></label>`).join('');

		const panel = document.createElement('div'); panel.id = PSM_PANEL_ID;
		panel.style.cssText = pos ? `left:${pos.x}px;top:${pos.y}px;right:auto;` : 'top:10px;right:10px;';

		panel.innerHTML = `<style>
            #${PSM_PANEL_ID}{position:fixed;width:420px;max-height:92vh;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;background:#fff;border:2px solid ${decision.color};border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.18);z-index:99999;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#333;user-select:none}
            #${PSM_PANEL_ID}::-webkit-scrollbar{display:none}#${PSM_PANEL_ID} *{box-sizing:border-box}
            .psm-hdr{background:linear-gradient(135deg,${decision.color},${decision.color}CC);color:#fff;padding:12px 14px;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:10}
            .psm-hdr-title{font-size:14px;font-weight:700}.psm-hdr-tag{display:inline-block;background:rgba(255,255,255,.22);padding:2px 10px;border-radius:10px;font-size:10px;font-weight:700;letter-spacing:.5px;margin-left:6px;vertical-align:middle}.psm-hdr-id{font-size:11px;opacity:.8;margin-top:2px}
            .psm-btn{background:rgba(255,255,255,.18);border:none;color:#fff;cursor:pointer;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:15px;margin-left:4px;transition:background .15s}.psm-btn:hover{background:rgba(255,255,255,.35)}
            .psm-sec{font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:#aaa;padding:10px 14px 3px;font-weight:600}
            .psm-stbox{background:${st.bgColor};border-left:5px solid ${st.color};margin:3px 12px 8px;padding:12px;border-radius:8px}.psm-stbox-val{font-size:19px;font-weight:800;color:${st.color}}.psm-stbox-sub{font-size:12px;color:#666;margin-top:3px}
            .psm-promise{margin:0 12px 8px;padding:8px 12px;border-radius:8px;font-size:12px;font-weight:600;display:flex;justify-content:space-between;align-items:center}.psm-promise-ok{background:#E6FFE6;color:#006622;border:1px solid #33AA55}.psm-promise-over{background:#FFE6E6;color:#CC0000;border:1px solid #FF4444}
            .psm-enoe{margin:0 12px 8px;padding:14px;background:#111827;border-radius:10px;border:1px solid #1f2937}.psm-enoe-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.psm-enoe-title{color:#FFAA00;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px}.psm-enoe-subtitle{color:#6b7280;font-size:10px;margin-top:2px;font-style:italic}.psm-enoe-count{font-size:20px;font-weight:900;font-family:'Courier New',monospace;color:${enoe.shouldReturn ? '#FF4444' : enoe.remaining === 1 ? '#FFAA00' : '#00FF88'}}
            .psm-dots{display:flex;align-items:center;gap:6px;margin:8px 0}.psm-dot{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;font-family:'Courier New',monospace}.psm-dot.filled{color:#fff;box-shadow:0 0 10px rgba(255,68,68,.4)}.psm-dot.empty{background:#1f2937;color:#555;border:2px dashed #374151}.psm-conn{flex:1;height:3px;background:#1f2937;border-radius:2px}.psm-conn.active{background:linear-gradient(90deg,#FF4444,#FF6644);box-shadow:0 0 5px rgba(255,68,68,.25)}
            .psm-progress{background:#1f2937;border-radius:4px;height:5px;margin:8px 0;overflow:hidden}.psm-progress-fill{height:100%;border-radius:4px;transition:width .4s}
            .psm-verdict{margin-top:8px;padding:7px 12px;border-radius:6px;font-size:12px;font-weight:600;text-align:center}.psm-v-ret{background:rgba(255,68,68,.12);color:#FF6666;border:1px solid rgba(255,68,68,.25)}.psm-v-warn{background:rgba(255,170,0,.12);color:#FFCC44;border:1px solid rgba(255,170,0,.25)}.psm-v-ok{background:rgba(0,255,136,.08);color:#00FF88;border:1px solid rgba(0,255,136,.15)}
            .psm-att-detail{margin-top:10px;font-size:11px;color:#9ca3af;font-family:'Courier New',monospace}.psm-att-day{padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06)}.psm-att-day:last-child{border-bottom:none}.psm-att-day-hdr{color:#e5e7eb;font-weight:700;font-size:11px;margin-bottom:3px}.psm-att-day-fail{color:#9ca3af;font-size:10px;padding-left:12px}
            .psm-dwell{display:flex;gap:6px;margin:0 12px 8px}.psm-dw-card{flex:1;background:#f8f9fa;border-radius:8px;padding:10px;text-align:center}.psm-dw-val{font-size:17px;font-weight:700;color:#333}.psm-dw-lbl{font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}.psm-badge{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-top:4px;color:#fff}
            .psm-fpath{margin:0 12px 8px;display:flex;align-items:center;flex-wrap:wrap;gap:4px}.psm-fnode{background:#E8F0FE;border:1px solid #B0C4DE;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:600;color:#336}.psm-fnode.cur{background:${st.color}18;border-color:${st.color};color:${st.color};font-weight:800}.psm-farrow{color:#aaa;font-size:13px}
            .psm-action{background:#111827;color:#00FF88;margin:0 12px 8px;padding:14px;border-radius:8px;font-family:'Courier New',monospace;font-size:12px;line-height:1.6;border:1px solid #1f2937;white-space:pre-wrap}.psm-action-hdr{color:#FFAA00;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;display:flex;align-items:center;gap:8px}.psm-action-pri{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;color:#fff}
            .psm-anomaly{margin:0 12px 8px;padding:10px 12px;background:#FFF8E1;border:1px solid #FFD54F;border-radius:8px;font-size:11px;color:#7B6B00}.psm-anomaly-title{font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;color:#E65100}
            .psm-flags{margin:0 12px 8px;padding:10px 12px;background:#f8f9fa;border-radius:8px;border:1px solid #e5e7eb}.psm-flag{display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:12px}.psm-flag input{display:none}.psm-flag-slider{width:34px;height:18px;background:#ccc;border-radius:9px;position:relative;transition:background .2s;flex-shrink:0}.psm-flag-slider::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;background:#fff;border-radius:50%;transition:transform .2s;box-shadow:0 1px 3px rgba(0,0,0,.2)}.psm-flag input:checked+.psm-flag-slider{background:#00AA44}.psm-flag input:checked+.psm-flag-slider::after{transform:translateX(16px)}.psm-flag-label{flex:1;color:#555;font-weight:500}.psm-flag-status{font-size:10px;font-weight:700;font-family:'Courier New',monospace;min-width:28px;text-align:right}.psm-flag input:checked~.psm-flag-status{color:#00AA44}.psm-flag input:not(:checked)~.psm-flag-status{color:#999}
            .psm-tl{margin:0 12px 10px}.psm-tl-hdr{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#888;padding:0 0 6px;border-bottom:1px solid #eee;margin-bottom:6px;cursor:pointer;user-select:none;font-weight:600}.psm-tl-hdr:hover{color:#555}
            .psm-ev{display:flex;align-items:flex-start;padding:5px 0;border-left:2px solid #e5e7eb;margin-left:7px;padding-left:10px;position:relative}.psm-ev::before{content:'';position:absolute;left:-5px;top:9px;width:8px;height:8px;border-radius:50%}.psm-ev.TRANSIT::before{background:#8888AA}.psm-ev.STATION::before{background:#0066CC}.psm-ev.DELIVERY::before{background:#00AA44}.psm-ev.FAILURE::before{background:#FF4444}.psm-ev.TERMINAL::before{background:#009933}.psm-ev.REVERSE::before{background:#AA5500}.psm-ev.UNKNOWN::before{background:#FF6B00;box-shadow:0 0 6px rgba(255,107,0,.5)}.psm-ev-date{font-size:10px;color:#999;min-width:82px;font-family:'Courier New',monospace}.psm-ev-icon{margin-right:5px;font-size:13px}.psm-ev-text{font-size:11px;color:#555;flex:1;word-break:break-word}.psm-ev.UNKNOWN .psm-ev-text{color:#E65100;font-weight:600}
            .psm-map{margin:0 12px 8px;padding:10px;background:#f8f9fa;border-radius:8px;border:1px solid #e5e7eb}.psm-map-states{display:flex;flex-wrap:wrap;gap:4px}.psm-map-state{padding:3px 8px;border-radius:5px;font-size:10px;font-weight:600;border:1px solid #ddd;background:#fff;color:#888;opacity:.5}.psm-map-state.visited{opacity:1;border-color:#0066CC;color:#0066CC;background:#E6F0FF}.psm-map-state.current{opacity:1;border-color:${st.color};color:#fff;background:${st.color};font-weight:800;box-shadow:0 0 8px ${st.color}44}
            .psm-body-off{display:none!important}.psm-ft{background:#f8f9fa;padding:6px 12px;border-radius:0 0 12px 12px;text-align:center;font-size:10px;color:#bbb;border-top:1px solid #eee}
        </style>
        <div class="psm-hdr" id="psm-drag-handle"><div><div class="psm-hdr-title">🚦 Status Machine <span class="psm-hdr-tag">${decision.tag}</span></div><div class="psm-hdr-id">📦 ${packageId}</div></div><div style="display:flex;align-items:center"><button class="psm-btn" id="psm-refresh" title="Recarregar">⟳</button><button class="psm-btn" id="psm-toggle" title="Minimizar">−</button><button class="psm-btn" id="psm-close" title="Fechar">×</button></div></div>
        <div id="psm-body">
            <div class="psm-sec">Status Atual</div>
            <div class="psm-stbox"><div class="psm-stbox-val">${st.icon} ${st.label}</div>${cur?.subStatus ? `<div class="psm-stbox-sub">⚡ <strong>${cur.subStatus}</strong></div>` : ''}${cur?.facility ? `<div class="psm-stbox-sub">📍 ${cur.facility}</div>` : ''}${cur?.route ? `<div class="psm-stbox-sub">🛣️ Rota: ${cur.route}</div>` : ''}</div>
            ${promise ? `<div class="psm-promise ${promise.isOverdue ? 'psm-promise-over' : 'psm-promise-ok'}"><span>📅 Promessa: ${promise.raw}</span><span>${promise.isOverdue ? `⚠️ VENCIDA (${promise.daysOverdue}d)` : '✅ No prazo'}</span></div>` : ''}
            <div class="psm-sec">Tentativas EnoE</div>
            <div class="psm-enoe"><div class="psm-enoe-hdr"><div><div class="psm-enoe-title">Contador (por dia)</div><div class="psm-enoe-subtitle">Múltiplas falhas no mesmo dia = 1 tentativa</div></div><div class="psm-enoe-count">${enoe.count} / ${RETURN_POLICY.maxAttempts}</div></div><div class="psm-dots">${dots.join('')}</div><div class="psm-progress"><div class="psm-progress-fill" style="width:${enoe.progressPct}%;background:${enoe.shouldReturn ? '#FF4444' : enoe.remaining === 1 ? '#FFAA00' : '#00FF88'}"></div></div><div class="psm-verdict ${enoe.shouldReturn ? 'psm-v-ret' : enoe.remaining === 1 ? 'psm-v-warn' : 'psm-v-ok'}">${enoe.shouldReturn ? (enoe.immediateReturn ? `⛔ DEVOLUÇÃO IMEDIATA — ${enoe.immediateReason}` : '🔙 LIMITE ATINGIDO — DEVOLUÇÃO') : enoe.remaining === 1 ? '⚠️ ÚLTIMA TENTATIVA!' : `✅ ${enoe.remaining} restante(s)`}</div>${enoe.attempts.length ? `<div class="psm-att-detail">${enoe.attempts.map((a, i) => `<div class="psm-att-day"><div class="psm-att-day-hdr">${a.hasRefusal ? '⛔' : '🔴'} #${i + 1} — ${a.dayKey}${a.route ? ` (Ruta ${a.route})` : ''}</div>${a.failures.map(f => `<div class="psm-att-day-fail">↳ ${f.reason}${f.date ? ` às ${f.date.split(' ')[1] || f.date}` : ''}</div>`).join('')}</div>`).join('')}</div>` : ''}</div>
            ${dwell ? `<div class="psm-sec">Tempo</div><div class="psm-dwell"><div class="psm-dw-card"><div class="psm-dw-val">${dwell.sinceLastUpdate}</div><div class="psm-dw-lbl">Último update</div><div class="psm-badge" style="background:${dwell.isVeryStale ? '#FF4444' : dwell.isStale ? '#FFAA00' : '#00CC66'}">${dwell.isVeryStale ? '🔴 CRÍTICO' : dwell.isStale ? '🟡 ATRASADO' : '🟢 OK'}</div></div><div class="psm-dw-card"><div class="psm-dw-val">${dwell.totalJourney}</div><div class="psm-dw-lbl">Jornada total</div></div></div>` : ''}
            <div class="psm-sec">Caminho</div><div class="psm-fpath" id="psm-fpath"></div>
            <div class="psm-sec">Mapa de Estados</div><div class="psm-map"><div class="psm-map-states" id="psm-smap"></div></div>
            ${anomalies.length ? `<div class="psm-anomaly"><div class="psm-anomaly-title">⚠️ Transições Anômalas (${anomalies.length})</div>${anomalies.map(a => `<div style="padding:2px 0">• ${a.message}</div>`).join('')}</div>` : ''}
            <div class="psm-sec">Decisão</div><div class="psm-action"><div class="psm-action-hdr">⚡ Ação <span class="psm-action-pri" style="background:${decision.color}">${decision.priority}</span></div><div>${decision.action}</div></div>
            <div class="psm-sec">⚙️ Regras</div><div class="psm-flags" id="psm-flags">${flagsHtml}</div>
            <div class="psm-tl"><div class="psm-tl-hdr" id="psm-tl-toggle">▼ Timeline (${tokens.length})</div><div id="psm-tl-list"></div></div>
        </div>
        <div class="psm-ft">MeliTools v2.4.0 · ${new Date().toLocaleString('pt-BR')}</div>`;

		document.body.appendChild(panel);

		// Facilities
		const fp = [], fs = new Set();
		for (const t of [...tokens].reverse()) { if (t.facility && !fs.has(t.facility)) { fs.add(t.facility); fp.push(t.facility); } }
		const fC = document.getElementById('psm-fpath');
		fp.forEach((f, i) => { const n = document.createElement('span'); n.className = `psm-fnode${f === cur?.facility ? ' cur' : ''}`; n.textContent = f; fC.appendChild(n); if (i < fp.length - 1) { const a = document.createElement('span'); a.className = 'psm-farrow'; a.textContent = '→'; fC.appendChild(a); } });

		// State map
		const vis = new Set(tokens.map(t => t.stateId)), csid = tokens[0]?.stateId;
		const sC = document.getElementById('psm-smap');
		Object.keys(STATES).filter(k => k !== '_unknown').forEach(sid => { const s = STATES[sid], el = document.createElement('span'); el.className = `psm-map-state${sid === csid ? ' current' : vis.has(sid) ? ' visited' : ''}`; el.textContent = `${s.icon} ${s.label}`; el.title = `${s.type} → ${s.allowedTransitions.join(', ') || '—'}`; sC.appendChild(el); });

		// Timeline
		const tL = document.getElementById('psm-tl-list');
		tokens.forEach(t => { const ev = document.createElement('div'); ev.className = `psm-ev ${t.state.type}`; ev.innerHTML = `<span class="psm-ev-date">${t.datetime || '--'}</span><span class="psm-ev-icon">${t.state.icon}</span><span class="psm-ev-text">${t.isUnknown ? '⚠️ ' : ''}${t.raw?.substring(0, 130) || '—'}</span>`; tL.appendChild(ev); });

		// Events
		document.getElementById('psm-close').onclick = () => panel.remove();
		document.getElementById('psm-toggle').onclick = () => { const b = document.getElementById('psm-body'), btn = document.getElementById('psm-toggle'); b.classList.toggle('psm-body-off'); btn.textContent = b.classList.contains('psm-body-off') ? '+' : '−'; };
		document.getElementById('psm-refresh').onclick = () => { panel.remove(); retries = 0; init(); };
		document.getElementById('psm-tl-toggle').onclick = () => { const l = document.getElementById('psm-tl-list'), h = document.getElementById('psm-tl-toggle'); const hid = l.style.display === 'none'; l.style.display = hid ? 'block' : 'none'; h.textContent = `${hid ? '▼' : '▶'} Timeline (${tokens.length})`; };
		document.getElementById('psm-flags').addEventListener('change', (e) => { const inp = e.target; if (!inp.dataset.flag) return; FLAGS[inp.dataset.flag].enabled = inp.checked; saveFlags(FLAGS); const s = inp.closest('.psm-flag').querySelector('.psm-flag-status'); if (s) s.textContent = inp.checked ? 'ON' : 'OFF'; panel.remove(); retries = 0; init(); });
		makeDraggable(panel, document.getElementById('psm-drag-handle'));
	}

	// =============================================
	// MAIN
	// =============================================
	let retries = 0;
	function init() {
		const entries = scrapeHistory();
		if (!entries.length && retries < MAX_RETRIES) { retries++; setTimeout(init, POLL_INTERVAL); return; }
		if (!entries.length) { console.warn('[PSM] Histórico não encontrado.'); return; }
		FLAGS = loadFlags();
		const pid = getPackageId(), tokens = tokenizeHistory(entries), unknowns = collectUnknowns(tokens);
		const enoe = countAttempts(tokens), dwell = calculateDwell(tokens), promise = checkPromise();
		const anomalies = validateTransitions(tokens), decision = decide(tokens, enoe, promise, dwell);
		console.log('[PSM v2.4]', { tokens, unknowns, enoe, dwell, promise, anomalies, decision, FLAGS });
		render(tokens, decision, dwell, enoe, promise, anomalies, pid);
		if (unknowns.length > 0) setTimeout(() => showUnknownModal(unknowns, pid), 600);
	}

	if (document.readyState === 'complete') setTimeout(init, 1500);
	else window.addEventListener('load', () => setTimeout(init, 1500));
	let lastUrl = location.href;
	new MutationObserver(() => { if (location.href !== lastUrl) { lastUrl = location.href; retries = 0; setTimeout(init, 1500); } }).observe(document, { subtree: true, childList: true });
})();
