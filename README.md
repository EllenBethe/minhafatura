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
npx serve .
```

## Segurança

As regras do Firestore estão em [`firestore.rules`](firestore.rules): cada usuário só acessa
`users/{uid}` e suas subcoleções. Publique-as pelo console do Firebase ou com
`firebase deploy --only firestore:rules`.

A `apiKey` do Firebase no `app.js` é pública por design; a proteção vem das regras.
Recomendado: restringir a chave aos domínios do app no Google Cloud Console e ativar o App Check.

## Deploy

A cada deploy, incremente a versão `CACHE` em `sw.js` para que os usuários recebam os arquivos novos.
