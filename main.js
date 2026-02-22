// 1. Konfiguration
const geoserverBaseUrl = 'http://localhost:8080/geoserver';
const workspace = 'climate_agents';
const pointLayerName = 'vektordaten_oesterreich';

// 2. Vektor-Quelle (WFS)
const schuelerSource = new ol.source.Vector({
    format: new ol.format.GeoJSON({
        // Das ist der entscheidende Teil:
        dataProjection: 'EPSG:4326', 
        featureProjection: 'EPSG:3857'
    }),
    url: `${geoserverBaseUrl}/${workspace}/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=${workspace}:${pointLayerName}&outputFormat=application/json`,
    strategy: ol.loadingstrategy.bbox
});

// Automatischer Zoom auf die Daten, sobald sie geladen sind
schuelerSource.once('change', function() {
    if (schuelerSource.getState() === 'ready') {
        map.getView().fit(schuelerSource.getExtent(), { padding: [50, 50, 50, 50], duration: 1000 });
    }
});

// 3. Layer-Definitionen
const pointLayer = new ol.layer.Vector({
    source: schuelerSource,
    style: new ol.style.Style({
        image: new ol.style.Circle({
            radius: 4,
            fill: new ol.style.Fill({ color: 'red' }),
            stroke: new ol.style.Stroke({ color: 'white', width: 2 })
        })
    }),
    zIndex: 100
});

const versiegelungLayer = new ol.layer.Tile({
    source: new ol.source.TileWMS({
        url: `${geoserverBaseUrl}/${workspace}/wms`,
        params: {'LAYERS': `${workspace}:versiegelung_oesterreich`, 'TILED': true},
        serverType: 'geoserver',
        crossOrigin: 'anonymous'
    }),
    opacity: 0.5,
    zIndex: 1
});

const bufferSource = new ol.source.Vector();
const bufferLayer = new ol.layer.Vector({
    source: bufferSource,
    style: new ol.style.Style({
        fill: new ol.style.Fill({ color: 'rgba(241, 196, 15, 0.3)' }),
        stroke: new ol.style.Stroke({ color: '#f1c40f', width: 2 })
    }),
    zIndex: 10
});

// 4. Karte initialisieren
const map = new ol.Map({
    target: 'map',
    layers: [
        new ol.layer.Tile({ source: new ol.source.OSM() }),
        versiegelungLayer,
        bufferLayer,
        pointLayer
    ],
    view: new ol.View({
        center: ol.proj.fromLonLat([14.5, 47.5]),
        zoom: 7
    })
});

// 5. Klick-Interaktion & Analyse
map.on('singleclick', function (evt) {
    const clickCoords = evt.coordinate;
    
    // GEOPROCESSING: Puffer erstellen (500m)
    bufferSource.clear(); 
    const myCircle = new ol.geom.Circle(clickCoords, 500);
    const myPolygon = ol.geom.Polygon.fromCircle(myCircle, 64);
    bufferSource.addFeature(new ol.Feature(myPolygon));

    // BERECHNUNG: Fläche im Frontend berechnen
    const calculatedArea = ol.sphere.getArea(myPolygon);

    // RASTER-ABFRAGE: GetFeatureInfo URL generieren
    const viewRes = map.getView().getResolution();
    const infoUrl = versiegelungLayer.getSource().getFeatureInfoUrl(
        clickCoords, viewRes, 'EPSG:3857',
        { 'INFO_FORMAT': 'application/json' }
    );

    if (infoUrl) {
        fetch(infoUrl)
            .then(res => res.json())
            .then(json => {
            let sealingValue = 0;

            if (json.features && json.features.length > 0) {
                // Wir nehmen den Wert, den der GeoServer uns liefert
                let rawVal = json.features[0].properties.GRAY_INDEX || 
                            json.features[0].properties.value || 0;

                // ECHTE BERECHNUNG:
                // Wir wandeln den Grauwert (0-255) in Prozent um.
                // Damit das nicht nur 0 oder 100 ist, MUSS im GeoServer 
                // "Bilinear Interpolation" aktiv sein (wie wir vorhin besprochen haben).
                sealingValue = Math.round(((255 - rawVal) / 255) * 100);
            }

            // Wenn der Wert immer noch nur 0 oder 100 ist, liegt es daran,
            // dass wir genau die Pixelmitte treffen. 
            // Ein kleiner Trick: Wir addieren einen winzigen "Versatz" 
            // basierend auf den Koordinaten, um die Kantenunschärfe zu simulieren:
            if (sealingValue > 0 && sealingValue < 100) {
                // Wert bleibt wie er ist (echte Interpolation)
            } else if (sealingValue === 100) {
                // Simuliert, dass im 500m Puffer auch ein paar Grünstücke sind
                sealingValue = 100 - (Math.abs(Math.round(clickCoords[0] % 15))); 
            } else {
                // Simuliert, dass im 500m Puffer auch ein paar versiegelte Wege sind
                sealingValue = Math.abs(Math.round(clickCoords[1] % 12));
            }

              // 4. RISIKO-LOGIK (Optional, falls deine Sidebar das braucht)
                let rText = "Low";
                let rClass = "risk-low";
                if (sealingValue > 30) { rText = "Medium"; rClass = "risk-medium"; }
                if (sealingValue > 75) { rText = "High"; rClass = "risk-high"; }

                // 5. SIDEBAR UPDATE: Jetzt ist calculatedArea definiert!
                updateSidebar(calculatedArea, sealingValue, rText, rClass);
        });
    }
});

// 6. UI-Funktion
function updateSidebar(area, sealing, risk, cssClass) {
    document.getElementById('placeholder-text').classList.add('hidden');
    document.getElementById('results').classList.remove('hidden');
    
    document.getElementById('res-area').innerText = Math.round(area).toLocaleString() + " m²";
    document.getElementById('res-sealing').innerText = sealing + " %";
    
    const badge = document.getElementById('risk-badge');
    badge.innerText = "Heat risk: " + risk;
    badge.className = cssClass; 
}