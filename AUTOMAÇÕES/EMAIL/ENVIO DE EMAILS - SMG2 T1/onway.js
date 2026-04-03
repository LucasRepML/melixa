/**
 * Busca a cotação atual do Dólar em tempo real
 */
function obterCotacaoDolar() {
	try {
		var url = "https://economia.awesomeapi.com.br/last/USD-BRL";
		var response = UrlFetchApp.fetch(url);
		var json = JSON.parse(response.getContentText());
		var cotacao = parseFloat(json.USDBRL.bid);
		Logger.log("Cotação obtida: " + cotacao);
		return cotacao;
	} catch (e) {
		Logger.log("Erro ao buscar cotação: " + e.message);
		// Usa uma cotação padrão em caso de erro
		return 5.0;
	}
}

/**
 * Converte um valor de BRL para USD
 */
function converterParaUSD(valorBRL, cotacao) {
	// Remove vírgula se existir (formato brasileiro)
	if (typeof valorBRL === "string") {
		valorBRL = parseFloat(valorBRL.replace(",", "."));
	}
	return valorBRL / cotacao;
}

/**
 * Função principal que agrupa os dados por origem e envia os e-mails com assinatura real do Gmail.
 */
function sendEmailsJustificativa() {
	var ss = SpreadsheetApp.getActiveSpreadsheet();
	var sheet = ss.getSheetByName("ON WAY");
	var data = sheet.getDataRange().getValues();

	// Captura a assinatura padrão do seu Gmail corretamente
	var minhaAssinatura = "";
	try {
		var sendAs = Gmail.Users.Settings.SendAs.list("me").sendAs;
		for (var i = 0; i < sendAs.length; i++) {
			if (sendAs[i].isDefault) {
				minhaAssinatura = sendAs[i].signature;
				break;
			}
		}
	} catch (e) {
		Logger.log("Erro ao buscar assinatura: " + e.message);
		minhaAssinatura = "--<br>Enviado via Automação Google Sheets";
	}

	// --- MAPEAMENTO DE DESTINATÁRIOS (Ajuste os e-mails aqui) ---
	var mapeamentoDestinatariosDefault =
		"genderson.reseende@mercadolivre.com, marcelo.esteves@mercadolivre.com";
	var mapeamentoDestinatariosLossPrevention =
		"lucas.stanley@mercadolivre.com, rayane.cruz@mercadolivre.com, maria.saceloti@mercadolivre.com";
	var ccoDefault =
		"johnny.msilva@mercadolivre.com, lucastav.campos@mercadolivre.com";
	var mapeamentoDestinatarios = {
		ARENA: "",
		BRBA01: "natalia.npace@mercadolivre.com",
		BRMG01: "fladimir.duarte@mercadolivre.com",
		BRMG02: "lpmg02@mercadolivre.com",
		BRMG03: "",
		BRPR01: "",
		BRSC02: "ccm.brsc02@mercadolivre.com",
		BRSP02: "marcello.miguelez@mercadolivre.com",
		BRSP03: "gustavo.marchezin@mercadolivre.com",
		BRSP04: "fernanda.cacita@mercadolivre.com",
		BRSP05: "joni.tieges@mercadolivre.com",
		BRSP06: "",
		BRSP09: "",
		BRSP10: "",
		BRSP11: "",
		BRSP15: "",
		BRXBA1: "italo.sa@mercadolivre.com",
		BRXES1: "cynthia.nascimento@mercadolivre.com",
		XMG1: "jessica.doliveira@mercadolivre.com, charles.abreu@mercadolivre.com, mariabernadete.pinto@mercadolivre.com",
		BRXGO1: "felipe.fquinalha@mercadolivre.com",
		BRXMG2: "",
		BRXPE1: "pedro.pcosta@mercadolivre.com",
		BRXPR1: "cesar.santos@mercadolivre.com",
		BRXPR2: "romanti.anastacio@mercadolivre.com",
		BRXPR3: "beatriz.srocha@mercadolivre.com",
		BRXRJ1: "jessica.jpereira@mercadolivre.com, fabiola.santosbp@dhl.com",
		BRXRS1: "lucas.secco@mercadolivre.com",
		BRXSC2: "marcos.mribeiro@mercadolivre.com",
		BRXSP1: "edival.santos@mercadolivre.com",
		BRXSP10: "isabella.ghirardello@mercadolivre.com",
		BRXSP11: "nadinny.sufen@mercadolivre.com",
		BRXSP14: "natalia.troya@mercadolivre.com",
		BRXSP16: "",
		BRXSP2: "leonardo.oguimaraes@mercadolivre.com, jacqueline.fvidal@mercadolivre.com, claudio.porto@mercadolivre.com, rodolfo.maglio@mercadolivre.com",
		BRXSP5: "",
		BRXSP6: "joao.rosa@mercadolivre.com",
		BRXSP7: "camila.schaffer@mercadolivre.com",
		BRXSP8: "maria.lnunes@mercadolivre.com",
		BRXSP9: "kevyn.costa@mercadolivre.com, lidiane.aureliano@mercadolivre.com, matheus.arbex@mercadolivre.com, gustavodssilva@mercadolivre.com",
		CAMPINAS: "",
		XSP4: "caio.marques@mercadolivre.com",
		BRRJ02: "albino.santos@mercadolivre.com, bruno.vieira@mercadolivre.com, paula.pgoncalves@mercadolivre.com, daniel.ndossantos@mercadolivre.com, jaime.nobre@mercadolivre.com, joao.azeredo@mercadolivre.com",
	};

	// DEBUG: Para facilitar os testes, vamos começar com um mapeamento mínimo. Depois, é só descomentar o mapeamento completo acima e ajustar os e-mails conforme necessário.
	// var mapeamentoDestinatariosDefault = "lucas.cdsouza@mercadolivre.com";
	// var mapeamentoDestinatariosLossPrevention = "lucastav.campos@mercadolivre.com";
	// var ccoDefault = "";
	// var mapeamentoDestinatarios = {
	//     "XMG1": "johnny.msilva@mercadolivre.com",
	//     "BRXSP16": "johnny.msilva@mercadolivre.com"
	// };

	// Busca a cotação do dólar uma vez
	var cotacaoDolar = obterCotacaoDolar();

	var gruposPorOrigem = {};
	var linhasParaMarcar = [];
	var origensComPacoteGrande = {}; // Controla quais origens têm pacotes > 100 USD

	// 1. Agrupar linhas que ainda não foram enviadas e verificar se há pacotes > 100 USD
	for (var i = 1; i < data.length; i++) {
		var foiEnviado = data[i][0]; // Coluna A (EMAIL)
		var origem = data[i][2]; // Coluna C (ORIGEM)
		var custoBRL = data[i][6]; // Coluna G (CUSTO em Real)

		if (
			foiEnviado === false ||
			foiEnviado === "FALSE" ||
			foiEnviado === ""
		) {
			if (!gruposPorOrigem[origem]) {
				gruposPorOrigem[origem] = [];
				origensComPacoteGrande[origem] = false;
			}
			gruposPorOrigem[origem].push({ index: i + 1, dados: data[i] });

			// Verifica se este pacote ultrapassa 100 USD
			var custoUSD = converterParaUSD(custoBRL, cotacaoDolar);
			if (custoUSD > 100) {
				origensComPacoteGrande[origem] = true;
				Logger.log(
					"Pacote encontrado com valor > 100 USD para " +
					origem +
					": R$ " +
					custoBRL +
					" = $ " +
					custoUSD.toFixed(2),
				);
			}
		}
	}

	var origens = Object.keys(gruposPorOrigem);
	if (origens.length === 0) {
		SpreadsheetApp.getUi().alert("Não há novos e-mails para enviar.");
		return;
	}

	// 2. Processar e enviar
	origens.forEach(function (origem) {
		// Só envia e-mail se a origem existe no mapeamento de destinatários
		if (mapeamentoDestinatarios.hasOwnProperty(origem)) {
			// sempre começamos com o destinatários padrão
			var destinatario = mapeamentoDestinatariosDefault;
			// se houver um destinatário específico (não-vazio), adicionamos ao padrão
			if (mapeamentoDestinatarios[origem]) {
				destinatario += ", " + mapeamentoDestinatarios[origem];
			}
			// Se houver pacote > 100 USD, adiciona LOSS PREVENTION
			if (origensComPacoteGrande[origem]) {
				destinatario += ", " + mapeamentoDestinatariosLossPrevention;
				Logger.log("LOSS PREVENTION adicionado para " + origem);
			}

			var corpoHtml = "<p>Olá, time.</p>";

			corpoHtml +=
				"<p>Identificamos pendência de envio do(s) seguinte(s) pacote(s) para o nosso SVC - SMG2:</p>";

			corpoHtml +=
				"<table border='1' style='border-collapse: collapse; width: 100%; font-family: Roboto, sans-serif;'>";
			corpoHtml += "<tr style='background-color: #2D3277; COLOR: #FFF'>";
			corpoHtml +=
				"<th>SHIPMENT</th><th>DATA</th><th>SEMANA</th><th>DESTINO</th><th>CUSTO</th><th>PRODUTO</th></tr>";

			gruposPorOrigem[origem].forEach(function (item) {
				var row = item.dados;
				var dataFormatada = Utilities.formatDate(
					new Date(row[3]),
					"GMT-3",
					"dd/MM/yyyy",
				);
				var custoBRLFormatado = parseFloat(row[6])
					.toFixed(2)
					.replace(".", ",");

				corpoHtml += "<tr>";
				corpoHtml +=
					"<td style='padding: 8px; text-align: center;'>" +
					row[1] +
					"</td>";
				corpoHtml +=
					"<td style='padding: 8px; text-align: center;'>" +
					dataFormatada +
					"</td>";
				corpoHtml +=
					"<td style='padding: 8px; text-align: center;'>" +
					row[4] +
					"</td>";
				corpoHtml +=
					"<td style='padding: 8px; text-align: center;'>" +
					row[5] +
					"</td>";
				corpoHtml +=
					"<td style='padding: 8px; text-align: right; white-space: nowrap;'>R$ " +
					custoBRLFormatado +
					"</td>";
				corpoHtml += "<td style='padding: 8px;'>" + row[7] + "</td>";
				corpoHtml += "</tr>";

				linhasParaMarcar.push(item.index);
			});

			corpoHtml += "</table>";

			corpoHtml += "<br>";

			corpoHtml +=
				"<p>Poderiam, por gentileza, verificar e agilizar a tratativa para regularização desse(s) envio(s)?</p>";

			corpoHtml += "<br><br>" + minhaAssinatura;

			GmailApp.sendEmail(
				destinatario,
				"Pacote(s) On Way SMG2 - " + origem,
				"",
				{
					htmlBody: corpoHtml,
					bcc: ccoDefault,
				},
			);
		}
	});

	// 3. Atualizar status na planilha
	linhasParaMarcar.forEach(function (linha) {
		sheet.getRange(linha, 1).setValue(true); // Marca Checkbox (A)
		sheet.getRange(linha, 9).setValue("COBRADO - EMAIL"); // Atualiza Status (I)
	});

	SpreadsheetApp.getUi().alert(
		"Processo concluído! Assinatura adicionada e status 'COBRADO - EMAIL' aplicado.",
	);
}
