// ==UserScript==
// @name         Sauron - Auto Scroll to Shipment
// @namespace    https://debugzone.com.br/
// @version      1.3.1
// @description  Auto scroll até o envio correto (Seller ID) + Debug toggle com persistência.
// @author       LucasWG
// @match        https://shipping-bo.adminml.com/sauron/shipments/shipment/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://github.com/LucasRepML/melixa/raw/refs/heads/main/AUTOMA%C3%87%C3%95ES/Sauron%20-%20Auto%20Scroll%20to%20Shipment.user.js
// @downloadURL  https://github.com/LucasRepML/melixa/raw/refs/heads/main/AUTOMA%C3%87%C3%95ES/Sauron%20-%20Auto%20Scroll%20to%20Shipment.user.js
// ==/UserScript==

(function () {
	'use strict';

	// ============================
	// ⚙️ CONFIG
	// ============================
	const STORAGE_KEY = 'sauron_autoscroll_debug';
	let DEBUG_ENABLED = localStorage.getItem(STORAGE_KEY) !== 'false';

	// ============================
	// 🔧 DEBUG MODAL
	// ============================
	const logs = [];
	let modalEl = null;
	let logContainer = null;
	let fabEl = null;
	let overlayEl = null;
	let toggleBtn = null;

	function createDebugModal() {
		overlayEl = document.createElement('div');
		overlayEl.id = 'debug-overlay';
		Object.assign(overlayEl.style, {
			position: 'fixed', top: '0', left: '0',
			width: '100vw', height: '100vh',
			backgroundColor: 'rgba(0,0,0,0.5)',
			zIndex: '999998', display: 'none'
		});
		overlayEl.addEventListener('click', () => toggleDebugModal(false));
		document.body.appendChild(overlayEl);

		modalEl = document.createElement('div');
		modalEl.id = 'debug-modal';
		Object.assign(modalEl.style, {
			position: 'fixed', bottom: '80px', right: '20px',
			width: '500px', maxHeight: '60vh',
			backgroundColor: '#1e1e1e', color: '#d4d4d4',
			borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
			zIndex: '999999', display: 'none',
			fontFamily: 'monospace', fontSize: '12px',
			overflow: 'hidden', flexDirection: 'column'
		});

		const header = document.createElement('div');
		Object.assign(header.style, {
			padding: '10px 14px', backgroundColor: '#333',
			display: 'flex', justifyContent: 'space-between', alignItems: 'center',
			borderBottom: '1px solid #555'
		});
		header.innerHTML = `<span style="font-weight:bold;color:#fff;">🐛 Debug Log</span>`;

		const headerRight = document.createElement('div');
		headerRight.style.display = 'flex';
		headerRight.style.gap = '8px';
		headerRight.style.alignItems = 'center';

		toggleBtn = document.createElement('button');
		updateToggleBtn();
		Object.assign(toggleBtn.style, {
			padding: '3px 10px', borderRadius: '6px', border: 'none',
			cursor: 'pointer', fontSize: '11px', fontWeight: 'bold'
		});
		toggleBtn.addEventListener('click', () => {
			DEBUG_ENABLED = !DEBUG_ENABLED;
			localStorage.setItem(STORAGE_KEY, DEBUG_ENABLED);
			updateToggleBtn();
			log(`Debug ${DEBUG_ENABLED ? 'ATIVADO' : 'DESATIVADO'}`, 'info');
		});

		const clearBtn = document.createElement('button');
		clearBtn.textContent = '🗑 Limpar';
		Object.assign(clearBtn.style, {
			padding: '3px 10px', borderRadius: '6px', border: 'none',
			backgroundColor: '#555', color: '#fff', cursor: 'pointer', fontSize: '11px'
		});
		clearBtn.addEventListener('click', () => {
			logs.length = 0;
			if (logContainer) logContainer.innerHTML = '';
		});

		const closeBtn = document.createElement('button');
		closeBtn.textContent = '✕';
		Object.assign(closeBtn.style, {
			padding: '3px 8px', borderRadius: '6px', border: 'none',
			backgroundColor: '#555', color: '#fff', cursor: 'pointer', fontSize: '13px'
		});
		closeBtn.addEventListener('click', () => toggleDebugModal(false));

		headerRight.appendChild(toggleBtn);
		headerRight.appendChild(clearBtn);
		headerRight.appendChild(closeBtn);
		header.appendChild(headerRight);

		logContainer = document.createElement('div');
		Object.assign(logContainer.style, {
			padding: '10px', overflowY: 'auto', maxHeight: '50vh'
		});

		modalEl.appendChild(header);
		modalEl.appendChild(logContainer);
		document.body.appendChild(modalEl);

		fabEl = document.createElement('div');
		fabEl.id = 'debug-fab';
		fabEl.textContent = '🐛';
		Object.assign(fabEl.style, {
			position: 'fixed', bottom: '20px', right: '20px',
			width: '50px', height: '50px', borderRadius: '50%',
			backgroundColor: '#3483fa', color: 'white',
			display: 'flex', alignItems: 'center', justifyContent: 'center',
			fontSize: '24px', cursor: 'pointer', zIndex: '999999',
			boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
		});
		fabEl.addEventListener('click', () => toggleDebugModal(true));
		document.body.appendChild(fabEl);
	}

	function updateToggleBtn() {
		if (!toggleBtn) return;
		toggleBtn.textContent = DEBUG_ENABLED ? '🔴 Debug OFF' : '🟢 Debug ON';
		toggleBtn.style.backgroundColor = DEBUG_ENABLED ? '#e74c3c' : '#2ecc71';
		toggleBtn.style.color = '#fff';
	}

	function toggleDebugModal(show) {
		if (!modalEl) return;
		modalEl.style.display = show ? 'flex' : 'none';
		overlayEl.style.display = show ? 'block' : 'none';
	}

	const LOG_COLORS = {
		info: '#3498db',
		success: '#2ecc71',
		warn: '#f39c12',
		error: '#e74c3c',
		debug: '#9b59b6',
		step: '#1abc9c'
	};

	function log(msg, type = 'info') {
		const time = new Date().toLocaleTimeString();
		const entry = { msg, type, time };
		logs.push(entry);

		if (DEBUG_ENABLED) {
			const color = LOG_COLORS[type] || '#d4d4d4';
			console.log(`%c[Sauron ${time}] ${msg}`, `color:${color};font-weight:bold;`);
		}

		if (logContainer) {
			const line = document.createElement('div');
			line.style.marginBottom = '4px';
			line.style.color = LOG_COLORS[type] || '#d4d4d4';
			line.textContent = `[${time}] ${msg}`;
			logContainer.appendChild(line);
			logContainer.scrollTop = logContainer.scrollHeight;
		}
	}

	function highlightElement(el) {
		const orig = el.style.cssText;
		el.style.outline = '3px solid #3483fa';
		el.style.outlineOffset = '2px';
		el.style.transition = 'outline 0.3s ease';
		setTimeout(() => {
			el.style.cssText = orig;
		}, 4000);
	}

	/**
	 * Sobe a árvore DOM para encontrar o card/container do envio.
	 * Procura por elementos que pareçam ser containers de envio.
	 */
	function findShipmentCard(el) {
		let current = el;
		let bestCandidate = null;

		for (let i = 0; i < 30 && current && current !== document.body; i++) {
			const rect = current.getBoundingClientRect();
			const tag = current.tagName?.toLowerCase();

			// Heurística: card de envio costuma ter altura > 200px e ser section/div/article
			if (['div', 'section', 'article'].includes(tag) && rect.height > 200) {
				bestCandidate = current;
				// Se o card tem altura > 500px, provavelmente é o card principal do envio
				if (rect.height > 500) {
					log(`Card candidato: <${tag}> h=${Math.round(rect.height)}px`, 'debug');
					return current;
				}
			}
			current = current.parentElement;
		}

		return bestCandidate;
	}

	/**
	 * Dentro de um card de envio, procura o elemento que contém "Seller ID"
	 */
	function findSellerIdInCard(card) {
		const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, null, false);
		let node;
		while ((node = walker.nextNode())) {
			if (node.textContent.includes('Seller ID')) {
				log(`Seller ID encontrado: "${node.textContent.trim().substring(0, 80)}"`, 'debug');
				return node.parentElement;
			}
		}
		return null;
	}

	// ============================
	// 🚀 MAIN
	// ============================
	// createDebugModal();

	log('Script iniciado.', 'info');
	log(`URL: ${window.location.href}`, 'debug');
	log(`Debug: ${DEBUG_ENABLED ? 'ATIVADO' : 'DESATIVADO'}`, 'info');

	// 1) Extrair ID da URL
	const urlMatch = window.location.pathname.match(/\/shipment\/(\d+)$/);
	if (!urlMatch) {
		log('Não foi possível extrair shipment ID da URL.', 'error');
		return;
	}
	const targetId = urlMatch[1];
	log(`Shipment ID alvo: ${targetId}`, 'success');

	// 2) Busca e scroll
	let attemptCount = 0;
	let found = false;

	function searchForShipment() {
		attemptCount++;
		log(`--- Tentativa #${attemptCount} ---`, 'step');

		// =============================================
		// FIX v1.2.1: Buscar ESPECIFICAMENTE o texto
		// "Envio #<targetId>" para evitar falso match
		// =============================================
		const exactPattern = `#${targetId}`;
		const envioPattern = new RegExp(`Envio\\s*#?\\s*${targetId}`);

		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
		let matchedElements = [];
		let exactEnvioMatches = [];
		let node;

		while ((node = walker.nextNode())) {
			const text = node.textContent;
			if (text.includes(targetId)) {
				const parent = node.parentElement;
				if (parent) {
					const entry = { textNode: node, element: parent };
					matchedElements.push(entry);

					// Prioridade máxima: texto que contém "Envio #<ID>" exatamente
					if (envioPattern.test(text) || text.includes(`#${targetId}`)) {
						exactEnvioMatches.push(entry);
					}
				}
			}
		}

		log(`Matches totais com ID: ${matchedElements.length}`, matchedElements.length > 0 ? 'success' : 'warn');
		log(`Matches exatos "Envio #${targetId}": ${exactEnvioMatches.length}`, exactEnvioMatches.length > 0 ? 'success' : 'warn');

		if (matchedElements.length === 0) return false;

		// Logar todos os matches para debug
		matchedElements.forEach((m, i) => {
			const el = m.element;
			const tag = el.tagName;
			const cls = el.className?.toString?.()?.substring(0, 80) || '';
			const text = m.textNode.textContent.trim().substring(0, 120);
			const isExact = exactEnvioMatches.includes(m) ? ' ✅ EXACT' : '';
			log(`  [${i}] <${tag} class="${cls}"> → "${text}"${isExact}`, 'debug');
		});

		// =============================================
		// PRIORIDADE DE SELEÇÃO:
		// 1. Match exato "Envio #<targetId>"
		// 2. Match com "#<targetId>" (links, headings)
		// 3. Fallback: primeiro visível (mas só se contém o targetId)
		// =============================================

		let envioMatch = null;

		// Prioridade 1: Buscar "Envio #ID" exato
		if (exactEnvioMatches.length > 0) {
			// Se houver múltiplos, pegar o que está visível
			envioMatch = exactEnvioMatches.find(m => {
				const rect = m.element.getBoundingClientRect();
				return rect.height > 0 && rect.width > 0;
			}) || exactEnvioMatches[0];
			log(`Selecionado via match exato "Envio #${targetId}"`, 'success');
		}

		// Prioridade 2: Match com "#<targetId>"
		if (!envioMatch) {
			envioMatch = matchedElements.find(m => {
				const text = m.textNode.textContent;
				return text.includes(`#${targetId}`);
			});
			if (envioMatch) {
				log(`Selecionado via match "#${targetId}"`, 'success');
			}
		}

		// Prioridade 3: Fallback — primeiro visível que contém o ID
		// MAS verificar que está num contexto de card de envio, não no header/sidebar
		if (!envioMatch) {
			envioMatch = matchedElements.find(m => {
				const rect = m.element.getBoundingClientRect();
				const isVisible = rect.height > 0 && rect.width > 0;
				// Evitar elementos no header (top < 100px) ou sidebar
				const isInContent = rect.top > 100 && rect.left < window.innerWidth * 0.8;
				return isVisible && isInContent;
			}) || matchedElements[0];
			log(`Selecionado via fallback (primeiro visível no conteúdo)`, 'warn');
		}

		log(`Match final: "${envioMatch.textNode.textContent.trim().substring(0, 80)}"`, 'success');

		// Subir para encontrar o card/container principal do envio
		const card = findShipmentCard(envioMatch.element);
		if (!card) {
			log('Não encontrou card pai. Usando o elemento direto.', 'warn');
		}

		const shipmentCard = card || envioMatch.element;
		log(`Card do envio: <${shipmentCard.tagName}> h=${Math.round(shipmentCard.getBoundingClientRect().height)}px`, 'debug');

		// Dentro do card, procurar o "Seller ID" para fazer scroll até lá
		const sellerTarget = findSellerIdInCard(shipmentCard);

		if (sellerTarget) {
			log(`Seller ID encontrado! Fazendo scroll até ele...`, 'success');
			sellerTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
			highlightElement(sellerTarget);
			log('🎉 SCROLL REALIZADO COM SUCESSO! (Seller ID)', 'success');
		} else {
			log('Seller ID não encontrado dentro do card. Fazendo scroll para o final do card...', 'warn');
			const lastChild = shipmentCard.lastElementChild;
			if (lastChild) {
				lastChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
				highlightElement(lastChild);
			} else {
				shipmentCard.scrollIntoView({ behavior: 'smooth', block: 'end' });
				highlightElement(shipmentCard);
			}
			log('🎉 SCROLL REALIZADO (fallback para final do card).', 'success');
		}

		return true;
	}

	// Retry loop
	const maxAttempts = 30;
	const interval = setInterval(() => {
		if (found || attemptCount >= maxAttempts) {
			clearInterval(interval);
			if (!found) {
				log(`❌ Não foi possível encontrar o envio #${targetId} após ${maxAttempts} tentativas.`, 'error');
			}
			return;
		}
		found = searchForShipment();
	}, 1000);

})();
