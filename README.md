# Digital Twin Forestale (Simulazione 3D Parametrica)

Piattaforma web 3D (Three.js) per simulare un ecosistema forestale come **digital twin**: terreno parametrico, specie vegetali configurabili, **sensori virtuali con costi/precisione**, suggerimenti AI (sensori + interventi) con **approvazione manuale** o modalita automatica.

## Avvio

```powershell
cd .\forest-digital-twin
npm install
npm run dev
```

Build produzione:

```powershell
npm run build
npm run preview
```

## App Desktop (Windows)

Modalita sviluppo (apre una finestra come app):

```powershell
npm run desktop:dev
```

Build installer (crea un setup in `release/` con collegamento Desktop/Start Menu):

```powershell
npm run desktop:build
```

Se `desktop:dev` dice "Port ... already in use", chiudi l'altro server Vite (altra finestra terminale) oppure cambia porta.

## Uso rapido

- Tab **Terreno**: imposta suolo (tipologia, umidita, NPK, pH, temperatura + stagioni, topografia/ombre) e clima (pioggia/vento/probabilita eventi). Usa **Rigenera terreno** per ricreare topografia e patch degradate.
- Tab **Specie**: aggiungi/modifica specie (crescita, radici, consumo acqua/nutrienti, semi, tolleranze, tempi).
- Tab **Sensori**:
  - **Consiglia posizionamento (AI)**: proposta ottimizzata per copertura informativa (con costo totale). Devi approvare.
  - **Posizionamento manuale**: scegli tipo, poi **clic** sul terreno 3D per piazzare (costo calcolato).
- Tab **AI**: genera suggerimenti di intervento (semina da droni, rimozione invasive, corridoi antincendio). L’AI **non puo intervenire** in celle senza copertura sensori.
- Tab **Metriche**: grafici e registro eventi/interventi.

## Visualizzazione

- **Overlay**: mostra copertura sensori (dati mancanti) o mappe (umidita, NPK, pH, biodiversita, invasive, rischio incendio).
- Click sul terreno: seleziona una cella e mostra in HUD le **misure** disponibili (con rumore in base alla precisione) oppure **ND** dove non ci sono sensori.
- Toggle **Mostra radici**: visualizza una proxy geometrica delle radici.

## Note tecniche

- Il motore ecologico e un modello “toy ma coerente” (risorse, competizione locale, mortalita, semi, stagioni, eventi casuali).
- La UI blocca interventi non misurati: senza sensori l’AI resta limitata e l’overlay evidenzia le aree senza dati.
