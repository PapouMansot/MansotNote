# API de correction pour un outil externe

Après déploiement de cette version, utiliser `POST /api/v1/ai/correct` sur le
serveur MansotNote. La route interne derrière nginx est `/v1/ai/correct`.
Un push Git seul ne rend pas la route disponible sur le serveur existant.

Créer un jeton personnel dans **Compte & Accès distant** et l’envoyer dans
`Authorization: Bearer <JETON_MANSOTNOTE>`. Ce jeton remplace la clé du fournisseur
pour cet appel ; une clé Google ou OpenRouter n’est pas un jeton MansotNote.
Les restrictions réseau existantes s’appliquent : accès privé/VPN ou adresse IP
enregistrée sur ce jeton. Ne pas activer l’accès public global pour brancher le correcteur.

## Requête et réponse

Corps JSON (le modèle est facultatif, `gemma4:e4b` par défaut) :

```json
{"text":"Bonjours, comment va tu ?","model":"gemma4:e4b"}
```

Réponse JSON :

```json
{
  "model": "gemma4:e4b",
  "correctedText": "Bonjour, comment vas-tu ?",
  "elapsedMs": 1234,
  "choices": [{"index": 0, "message": {"role": "assistant", "content": "Bonjour, comment vas-tu ?"}, "finish_reason": "stop"}]
}
```

Lire `correctedText`, ou `choices[0].message.content` si le client utilise déjà
ce format. La correction est non streaming, avec raisonnement désactivé.
Le serveur fournit le prompt de correction : conserver sens, langue, ton et
Markdown, sans explication. Il n’ajoute aucun contexte provenant des notes,
du profil de l’assistante ou du RAG et ne modifie aucune note.
Le texte est transmis au moteur IA configuré sur le serveur.

Exemple Python, avec l’URL complète et le jeton fournis par la configuration de l’outil :

```python
import requests

def corriger(texte, endpoint, jeton, modele="gemma4:e4b"):
    reponse = requests.post(
        endpoint,  # ex. https://notes.mansotfamily.fr/api/v1/ai/correct, après déploiement
        headers={"Authorization": f"Bearer {jeton}"},
        json={"text": texte, "model": modele},
        timeout=190,
    )
    reponse.raise_for_status()
    return reponse.json()["correctedText"]
```

## Client au format OpenAI / OpenRouter

Pour un client qui envoie déjà `messages` et lit `choices`, utiliser :

| Paramètre | Valeur |
| --- | --- |
| URL de base | `https://<serveur-mansotnote>/api/v1/ai` |
| URL complète de chat | `https://<serveur-mansotnote>/api/v1/ai/chat/completions` |
| Clé API | Jeton personnel MansotNote |
| Modèle | `gemma4:e4b`, ou un modèle autorisé par le serveur |
| Liste des modèles | `GET /api/v1/ai/models` avec le même jeton |

Cette route est le relais de chat général : le client fournit son prompt de
correction dans `messages`, avec `stream: false`, `think: false` et une température
basse. L’endpoint `/ai/correct` est préférable quand l’outil peut envoyer `text` :
il applique le prompt et rejette une génération tronquée.

Voice Shortcut, dans sa version actuelle, utilise des URL Google et OpenRouter
fixées dans `corrector_engine.py`. Il faut ajouter un fournisseur MansotNote ou
rendre l’URL configurable dans cet outil ; coller cette URL à la place d’une clé
Google/OpenRouter ne suffit pas. Les changements de ce dépôt n’éditent pas cet outil.

## Limites et erreurs

`text` doit être non vide et contenir au plus 10 000 caractères. Les seuls champs
acceptés par `/ai/correct` sont `text` et `model`. La sortie est plafonnée à
4 096 tokens ; une sortie tronquée est refusée plutôt que renvoyée comme complète.
Le serveur abandonne après 180 secondes ou à la déconnexion du client.
Le quota de 30 requêtes par minute et par IP est partagé avec les autres routes IA.

| Statut | Signification |
| --- | --- |
| 400 | Corps invalide, texte vide ou trop long |
| 401 | Jeton absent, invalide, expiré ou révoqué |
| 403 | Origine réseau refusée ou modèle non autorisé |
| 429 | Quota IA dépassé |
| 502 | Moteur indisponible, réponse vide, invalide ou tronquée |

Les réponses de correction réussies portent `Cache-Control: no-store`.
Conserver le texte original dans l’outil tant que la correction n’a pas réussi.
