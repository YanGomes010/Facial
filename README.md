# BioID — Reconhecimento Facial

Sistema de controle de acesso biométrico com NocoDB como banco de dados.

---

## 📁 Estrutura

```
bioid/
├── server.js          ← Backend Express (gerencia NocoDB)
├── package.json
├── .env               ← Suas credenciais (crie a partir do .env.example)
├── .env.example       ← Modelo de configuração
└── public/
    └── index.html     ← Frontend (servido pelo backend)
```

---

## 🚀 Instalação

### 1. Instale as dependências
```bash
npm install
```

### 2. Configure o `.env`
```bash
cp .env.example .env
```
Edite o `.env` com seus dados do NocoDB:
```
NOCODB_URL=http://localhost:8080
NOCODB_TOKEN=seu-xc-token-aqui
NOCODB_TABLE_ID=md_xxxxxxxxxxxxxx
PORT=3000
```

### 3. (Opcional) Crie a tabela automaticamente
Se ainda não tiver a tabela no NocoDB, crie via API:
```bash
curl -X POST http://localhost:3000/api/setup
```
Isso cria a tabela "usuarios" com todos os campos necessários e retorna o `tableId`.
Cole o `tableId` retornado no seu `.env` e reinicie o servidor.

### 4. Inicie o servidor
```bash
# Produção
npm start

# Desenvolvimento (reinicia automático)
npm run dev
```

### 5. Acesse o sistema
```
http://localhost:3000
```

---

## 🔗 Integração com n8n (opcional)

Se preferir usar n8n como middleware no lugar do acesso direto ao NocoDB:

1. No n8n, crie um Webhook com método GET na rota `/webhook/bioid-find`
   - Parâmetro: `cpf`
   - Conecte a um nó NocoDB → List Records (filtro: `cpf = {{$json.query.cpf}}`)
   - Retorne o primeiro registro encontrado

2. Crie outro Webhook POST em `/webhook/bioid-create`
   - Recebe o body JSON e insere no NocoDB via nó NocoDB → Create Record

3. No `server.js`, troque as chamadas diretas ao NocoDB pelos webhooks n8n:
   ```js
   const NC_URL = process.env.N8N_URL; // ex: http://localhost:5678
   // GET /api/user/:cpf → chama /webhook/bioid-find?cpf=xxx
   // POST /api/user     → chama /webhook/bioid-create com body
   ```

---

## 🛠 Endpoints do Backend

| Método | Rota              | Descrição                          |
|--------|-------------------|------------------------------------|
| GET    | `/api/status`     | Verifica se o backend está OK      |
| GET    | `/api/user/:cpf`  | Busca usuário pelo CPF             |
| POST   | `/api/user`       | Cadastra novo usuário              |
| POST   | `/api/setup`      | Cria tabela "usuarios" no NocoDB   |

---

## 🔧 Campos da Tabela NocoDB

| Campo             | Tipo          | Descrição                      |
|-------------------|---------------|-------------------------------|
| nome              | SingleLineText| Nome completo (Primary Key)   |
| cpf               | SingleLineText| CPF sem formatação (11 dígitos)|
| data_nascimento   | SingleLineText| Data (YYYY-MM-DD)             |
| email             | Email         | E-mail                        |
| telefone          | SingleLineText| Telefone formatado            |
| face_descriptor   | LongText      | JSON com array Float32[128]   |
| documento_foto    | LongText      | Base64 JPEG do documento      |

---

## 🐛 Correções aplicadas nesta versão

1. **Tela preta na câmera** — Reescrita da inicialização da câmera:
   - `startStream()` aguarda o evento `canplay` antes de iniciar a detecção
   - `video.play()` é chamado explicitamente
   - Canvas tem `z-index` e `background:transparent` explícitos
   - Dimensões do canvas são sincronizadas com o vídeo antes de cada frame

2. **Config pedida a cada login** — Backend centraliza as credenciais do NocoDB no `.env`. O frontend nunca vê ou armazena tokens.
