# Isoko: Rwanda market prices

Price comparison page + chatbot built from WFP Rwanda retail price data.

- `index.html`: the whole app (data is embedded)
- `data.json`: the same data, used by the optional AI function
- `api/chat.js`: optional AI mode (Vercel serverless function)

The chatbot works without any key (built-in answers from the data).
AI mode only turns on if `ANTHROPIC_API_KEY` is set on Vercel.

## Put it on GitHub

```
git init
git add .
git commit -m "Isoko market price app"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/isoko.git
git push -u origin main
```
(Create an empty repo named `isoko` on github.com first.)

## Deploy on Vercel

1. vercel.com > Add New > Project > import the `isoko` repo.
2. Leave the settings as they are and click Deploy.
3. Optional AI mode: Project > Settings > Environment Variables, add
   `ANTHROPIC_API_KEY`, then redeploy. Set a spending limit on your API
   account first: anyone who finds your page can use the chat.

Never put the API key in index.html or commit it to GitHub.
