# Pétition PCUS × FPLUS sur Netlify

La page (`public/index.html`) parle à une fonction Netlify (`netlify/functions/api.mjs`) qui garde les revendications et les signatures dans Netlify Blobs. Sans la fonction, la page s'affiche mais personne ne peut signer.

## Déployer (méthode fiable : Netlify CLI)

Dans ce dossier, avec Node 18 ou plus :

```bash
npm install
npx netlify-cli login
npx netlify-cli link          # choisis ton site existant
npx netlify-cli deploy --prod
```

Autre méthode : pousse ce dossier sur un dépôt GitHub et connecte-le au site dans Netlify (Site configuration > Build & deploy > Link repository).

Le glisser-déposer simple d'un dossier contenant seulement `index.html` ne déploie pas la fonction.

## Vérifier

Ouvre `https://TON-SITE.netlify.app/api/etat`. Tu dois voir du JSON qui commence par `{"revendications":`. Si tu obtiens une page 404, la fonction n'a pas été déployée.

## Activer la modération (recommandé)

Dans Netlify : Site configuration > Environment variables > Add a variable
- Clé : `ADMIN_CODE`
- Valeur : un code secret de ton choix

Redéploie ensuite. Un lien « Accès modérateur » apparaît en bas de la page : avec le code, tu peux retirer des revendications et n'importe quelle signature. Sans `ADMIN_CODE`, personne ne peut retirer de revendication.

## Règles du registre

- Tout le monde peut ajouter une revendication (60 au maximum, pas de doublon).
- Une signature par navigateur et par nom.
- Chaque signataire peut retirer sa propre signature depuis le navigateur où il a signé.
- L'horodatage est fait par le serveur. Chaque signature contient l'empreinte SHA-256 de son tracé, celle des revendications en vigueur et celle de la signature précédente : modifier une signature après coup casse la chaîne, et la page l'affiche.
- Une signature retirée laisse un maillon vide pour que la chaîne reste vérifiable.

Document parodique, sans valeur juridique.
