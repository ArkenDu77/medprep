# MedPrep v4 — Plateforme partagée Concours Santé

## Déploiement sur Render (gratuit)

### 1. Crée un repo GitHub
- Va sur github.com, crée un nouveau repo "medprep"
- Upload tous les fichiers de ce dossier

### 2. Déploie sur Render
1. Va sur **https://render.com** et crée un compte (gratuit)
2. Clique **New → Web Service**
3. Connecte ton repo GitHub "medprep"
4. Render détecte automatiquement le `render.yaml`
5. Ajoute les variables d'environnement :
   - `OPENAI_API_KEY` = ta clé OpenAI
   - `ADMIN_PASSWORD` = ton mot de passe admin
6. Clique **Deploy**
7. Attends 2-3 min, tu reçois une URL type `https://medprep-xxxx.onrender.com`

### 3. Utilise
- Toi : connecte-toi avec ton prénom + mot de passe admin → tu gères tout
- Tes amis : connectent avec leur prénom (sans mot de passe) → mode étudiant
- Tout le monde voit les mêmes cours, le même timer, fait la même colle
- Classement partagé avec les 103 FE

## Local (dev)
```bash
npm install
cp .env.example .env   # Édite avec ta clé + mdp
npm run dev             # Lance backend + frontend
```
Ouvre http://localhost:3000

## Architecture
- Frontend: React/Vite → build en fichiers statiques
- Backend: Express + SQLite → tout dans un fichier `medprep.db`
- Render sert les deux depuis le même service
- Polling toutes les 3s pour la synchronisation temps réel
