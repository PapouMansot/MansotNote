# Correction et pièces jointes du copilote

La correction depuis un outil externe utilise [l’API de correction](api-correction.md).
L’éditeur de notes conserve ses commandes de correction de la sélection ou de la note.

Le bouton trombone accepte les PDF, PNG, JPEG et WebP. Les fichiers peuvent
aussi être déposés sur la zone de saisie ; une image copiée peut y être collée.
Un message peut contenir jusqu’à quatre fichiers de 10 Mo chacun et quatre
images ou pages scannées au total. Un envoi sans texte demande une analyse des
pièces jointes.

Les PDF sont lus dans le navigateur par PDF.js. Les documents de plus de 50
pages sont refusés. Le texte est limité à 20 000 caractères par PDF et 32 000
caractères de documents par message ; les extraits tronqués sont signalés.
Les pages sans texte sont rendues en images, dans la limite de quatre pages
scannées. Les PDF protégés nécessitent une version déverrouillée.

Les images sont redimensionnées à 1 600 pixels maximum et transmises au modèle
IA configuré. Leur analyse, y compris celle des PDF scannés, nécessite un modèle
avec vision. Les PDF contenant du texte fonctionnent avec les modèles texte.
Le relais transmet les blocs OpenAI à llama.cpp et les adapte au champ `images`
de l’API native Ollama.

L’historique du chat plein écran reste propre au compte et au navigateur.
Les métadonnées et le texte PDF restent dans l’historique local ; les images
sont conservées séparément dans IndexedDB pour éviter la limite de localStorage.
Ces pièces jointes ne sont pas synchronisées sur d’autres appareils. Les
quatre images les plus récentes disponibles sont prioritaires dans le contexte
IA ; un document plus ancien peut être joint de nouveau pour le réexaminer.

Le nom choisi à l’accueil est utilisé dans les libellés et le prompt. Le prompt
précise qu’il remplace un ancien nom éventuellement présent dans l’historique.

La lecture locale s’appuie sur [l’API PDF.js de Mozilla](https://mozilla.github.io/pdf.js/api/).
