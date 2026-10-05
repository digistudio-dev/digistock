# DigiStock — recette (QA)

Tests automatisés : `npm test` (calculs, réapprovisionnement, codes-barres, CSV, permissions, formats) et `npm run test:rust` (transactions, stock, crédit, achats, inventaire, lots FEFO, authentification, activation Premium, sauvegarde, scénario complet de démonstration avec vérification des invariants).

## Scénarios manuels

| # | Scénario | Résultat attendu |
|---|---|---|
| 1 | Nouvelle installation | Assistant : bienvenue → entreprise → activité → tickets → administrateur → « Votre espace DigiStock est prêt. » |
| 2 | Connexion / verrouillage / changement de mot de passe | Mauvais mot de passe refusé ; écran verrouillé déverrouillable ; nouveau mot de passe actif |
| 3 | Création produit avec stock initial | Mouvement « Stock initial » visible dans la chronologie |
| 4 | Scan d'un code inconnu hors caisse | « Produit introuvable » + « Créer ce produit » avec le code prérempli |
| 5 | Achat reçu | Stock augmenté, mouvement « Achat #ACH-… », dette fournisseur, prix d'achat mis à jour si coché |
| 6 | Commande puis réception | Stock inchangé tant que non réceptionnée |
| 7 | Vente espèces avec monnaie | Stock diminué, ticket imprimable, PDF, monnaie affichée |
| 8 | Scans répétés en caisse | Quantité +1 à chaque scan, ligne surlignée, aucun dialogue |
| 9 | Vente à crédit avec acompte | Solde client augmenté du reste ; plafond respecté |
| 10 | Paiement client | Solde diminué, reçu PDF `PAY-…` |
| 11 | Annulation de vente (motif obligatoire) | Stock restauré, crédit extourné, vente marquée « Annulée » |
| 12 | Stock sous le minimum | Notification unique, badge « Faible / Critique / Rupture », centre d'actions |
| 13 | Inventaire | Écarts calculés, ajustements générés à la validation |
| 14 | Sauvegarde puis restauration | Copie « avant restauration » créée, données restaurées, reconnexion demandée |
| 15 | Activation Premium (code valide / invalide) | Activation immédiate / message d'erreur |
| 16 | WhatsApp : connexion QR, envoi | Statut « Connecté », envoi uniquement après « Envoyer », historique |
| 17 | Utilisateur caissier | Pas de prix d'achat, bénéfices, rapports ni paramètres |
| 18 | Transfert entre entrepôts | Mouvement « Transfert » dans chaque entrepôt |
| 19 | Rapports | Export PDF, CSV et impression |
| 20 | Import CSV | Aperçu, lignes invalides signalées, catégories/fournisseurs créés |
| 21 | Mode sombre, densité compacte, taille de texte | Interface lisible et cohérente |
| 22 | Redémarrage | Session fermée, données conservées, taille de fenêtre mémorisée |
