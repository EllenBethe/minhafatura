# MinhaFatura

PWA para controlar a fatura do cartão de crédito: lançamento de compras à vista e parceladas,
visão por fatura, resumo por categoria e sincronização em tempo real entre dispositivos.

**Stack:** HTML/CSS/JS puro (ES modules) + Firebase Auth + Cloud Firestore.

## Como funciona a fatura

- Compras feitas **até o dia anterior ao fechamento** entram na fatura do mesmo mês.
  A partir do dia de fechamento, entram na fatura do mês seguinte.
- Uma compra em N parcelas aparece em N faturas consecutivas.
- A fatura é sempre calculada a partir da data da compra, então alterar o dia de
  fechamento reposiciona todas as compras.

## Rodando localmente

Service workers e ES modules exigem HTTP (não abra via `file://`):

```bash
npm run serve   # http://localhost:3000
npm test        # testes da lógica (Node 20+, sem dependências)
npm ci && npm run e2e   # testes de tela (precisa do Google Chrome; ou defina CHROME_PATH)
```

Os testes de tela (`tests/e2e/`) abrem o app num Chrome sem janela com o Firebase
simulado (`tests/e2e/firebase-simulado.js`) e usam como uma pessoa usaria: busca,
filtros, lançar compra, estorno, troca de categoria, importar/desfazer e login.
Rodam no GitHub Actions em todo PR — se falharem, nada é publicado.

## Estrutura

- `app.js` — telas e Firebase. Eventos via `data-action` / `data-change` / `data-input`
  apontando para funções do objeto `ACOES` (nada de `onclick` no HTML).
- `js/fatura.js` — regras de fatura e parcelamento
- `js/importar.js` — leitura de CSV (Nubank, Inter, C6, genérico) e OFX
- `js/exportar.js` — planilhas CSV
- `js/grafico.js` — gráfico de faturas por categoria
- `js/icones.js` — ícones (Lucide, ISC) e cores das categorias
- `tests/` — `node --test`; inclui checagem de que todo `data-action` existe em `ACOES`
- `tests/e2e/` — testes de tela (puppeteer-core)

## Segurança

As regras do Firestore estão em [`firestore.rules`](firestore.rules): cada usuário só acessa
`users/{uid}` e suas subcoleções. Publique-as pelo console do Firebase ou com
`firebase deploy --only firestore:rules`.

A `apiKey` do Firebase no `app.js` é pública por design; a proteção vem das regras.
Recomendado: restringir a chave aos domínios do app no Google Cloud Console e ativar o App Check.

## Publicação

Automática pelo GitHub Actions (`.github/workflows/ci.yml`): push no `main` roda os testes e
publica em https://minhafatura.web.app; pull requests ganham uma prévia com link no PR.
A versão (`?v=` e `VERSION` no `sw.js`) é carimbada pelo workflow.

Manual, se precisar: `npm run versao && npm run deploy`.
