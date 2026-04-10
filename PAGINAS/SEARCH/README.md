# 📦 PackSearch

![Version](https://img.shields.io/badge/version-3.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![JavaScript](https://img.shields.io/badge/javascript-ES6%2B-yellow.svg)

> **Uma aplicação web moderna, rápida e sem servidor para busca inteligente e gerenciamento logístico de pacotes e remessas.**

O **PackSearch** permite que você processe, gerencie e faça buscas avançadas em grandes volumes de dados de envios diretamente pelo navegador. Construído com tecnologias web modernas, ele suporta a importação flexível através de múltiplos formatos (CSV tabular e blocos chave-valor), contando com um mecanismo de busca poderoso e armazenamento persistente com `IndexedDB`.

---

## ✨ Principais Funcionalidades

* **🔍 Busca Transacional Avançada:** Mecanismo rigoroso de filtragem de dados.
  * *Exata:* Busque por frases exatas usando `"entre aspas"`.
  * *Exclusão:* Remova termos indesejados da busca prefixando com `-termo`.
  * *Campos Específicos:* Utilize prefixos de escopo como `id:`, `svc:` e `tramo:`.
* **📊 Tratamento Inteligente de Dados:** Parser duplo adaptável.
  * Suporta arquivos `.csv` e `.txt`.
  * Reconhecimento automático de delimitadores (`,`, `;`, `|`, `\t`).
  * Normalização em tempo real de textos (remoção de acentos) e tipificação de datas em português (ex: "10 de janeiro").
  * Mapeamento de colunas automático com sistema de *aliases*.
* **💾 Persistência Offline (*Serverless*):** 
  * Dados são salvos de forma segura no seu próprio navegador utilizando **IndexedDB**.
  * Acesso e filtragem com latência quase nula.
  * Não há necessidade de infraestrutura ou banco de dados externo.
* **🎨 UI/UX Moderna:** 
  * Design responsivo, concebido com CSS Grid e Flexbox.
  * Modos *Light*, *Dark* ou *System-default* adaptativos.
  * Notificações *Toast* e *Progress Bars* não-bloqueantes.

---

## 🚀 Início Rápido

O PackSearch é uma aplicação estática (cliente). O setup é imediato e não impõe dependências complexas.

### Pré-requisitos
* Um navegador web moderno (Google Chrome 90+, Firefox 88+, Safari 14+, Edge 90+).

### Instalação e Execução

1. **Clone o repositório:**
   ```bash
   git clone https://seu-repositorio/PackageSearch.git
   cd PackageSearch
   ```

2. **Sirva a aplicação:**
   *Recomendamos a utilização de um servidor HTTP local simples para contornar políticas de restrição de CORDs em importações caso necessário, ou abrir o arquivo diretamente.*
   ```bash
   # Utilizando Python 3:
   python3 -m http.server 8000
   
   # Em seguida, acesse no navegador:
   # http://localhost:8000/src/
   ```

---

## 📖 Guia de Uso

### 1. Importação de Dados
Na tela inicial, utilize o botão superior de **Importar** para carregar seu arquivo.

* **CSV Suportado (Exemplo de Estrutura)**
  ```csv
  shipment,descri,shp_lg_facility_id,status,atualizao,valor_usd,origem
  SMG001,Pacote A,SMG2,Em Trânsito,10 de janeiro de 2026,150.00,São Paulo
  ```
*O sistema mapeará automaticamente `shipment` para `id`, `descri` para `descricao`, etc.*

### 2. Sintaxe de Busca
A barra de pesquisa provê um modo intuitivo para localizar instâncias de pacotes e realizar diagnósticos cruzados:

| Caso de Uso | Exemplo de Sintaxe | O que faz? |
| :--- | :--- | :--- |
| **Geral** | `pacote` | Retorna qualquer card contendo "pacote". |
| **Composição** | `"são paulo" svc:SMG2` | Requer que o destino exato seja "são paulo" E possua facilidade SMG2. |
| **Exclusão** | `id:12 -cancelado` | Pacotes do ID que contém 12 onde o trecho de texto "cancelado" não está. |
| **Trajeto** | `tramo:ONWAY` | Filtro específico na coluna/dados lidos de *tramo*. |

---

## 🛠 Arquitetura do Projeto

A base de código mantém as coisas intencionalmente simples, legíveis e separadas por contexto, favorecendo o *Vanilla JS*.

```text
PackageSearch/
├── README.md             # Este arquivo de documentação
└── src/
    ├── index.html        # Estrutura principal e marcação (DOM)
    ├── app.js            # Engine de importação, parser, cache e busca
    └── styles.css        # Sistema de design, estilos globais e tema
```

---

## 💻 Desenvolvimento & Extensão

A arquitetura baseada em Javascript vanilla permite adições fáceis com mínimo de atrito.

**Adicionando novos apelidos ao importador:**
No arquivo `src/app.js`, você pode incluir novos mapeamentos de propriedades na constante `COL_MAP`:
```javascript
const COL_MAP = {
  meu_novo_identificador: "chaveInternaRefinada",
  status_pacote: "status"
  // ... adicione mappings customizados aqui
};
```

**Alterando o padrão de formatação de datas:**
Se precisa oferecer suporte a novos termos logísticos de datas ou idiomas, atualize o objeto `MONTHS` em `src/app.js`:
```javascript
const MONTHS = {
  jan: 0, fev: 1, mar: 2, /* ... */
  ene: 0, feb: 1, mar: 2  // Exemplo de extensão para formato em espanhol
};
```

---

## 🤝 Contribuindo

Contribuições são sempre bem-vindas! Para mudanças maiores, por favor, abra uma *issue* primeiro para discutir o que você gostaria de alterar e alinhar junto à comunidade as visões do projeto.

1. Faça o *Fork* do projeto
2. Crie uma branch de funcionalidade (`git checkout -b feature/NovaFuncionalidade`)
3. Realize seus *commits* descritivos (`git commit -m 'feat: adicionei novas métricas ao dashboard'`)
4. Suba suas alterações para a sua branch originada do *fork* (`git push origin feature/NovaFuncionalidade`)
5. Abra um *Pull Request* no repositório principal indicando a proposta de valor.

---

## 📝 Licença
Distribuído sob a licença **MIT**. Consulte o arquivo de licença para mais informações de uso e isenção de responsabilidade.

## ✉️ Suporte e Contato
Para relatar problemas (bugs) ou solicitar melhorias, por favor registre um registro pelo sistema de rastreamento do GitHub.

### 🎯 Roadmap Futuro
* Exportação consolidada de buscas em formatos Excel/JSON.
* Funcionalidades de sincronização bidirecional via API Restful.
* Módulos avançados de análise e criação de gráficos integrados.
* Integração de testes automatizados e workflows de validação contínua.
