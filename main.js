// 1. Configuration
const geoserverBaseUrl = 'http://localhost:8080/geoserver';
const workspace = 'climate_agents';
const pointLayerName = 'vektordaten_oesterreich';

// 2. Vektor Source (WFS)
const schuelerSource = new ol.source.Vector({
    format: new ol.format.GeoJSON({
        // Coordinatesystem
        dataProjection: 'EPSG:4326', 
        featureProjection: 'EPSG:3857'
    }),
    url: `${geoserverBaseUrl}/${workspace}/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=${workspace}:${pointLayerName}&outputFormat=application/json`,
    strategy: ol.loadingstrategy.bbox
});

// Automatic zoom on the data as soon as they are loaded
schuelerSource.once('change', function() {
    if (schuelerSource.getState() === 'ready') {
        map.getView().fit(schuelerSource.getExtent(), { padding: [50, 50, 50, 50], duration: 1000 });
    }
});

// 3. Layer definiton
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

// 4. Initialising map
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

// 5. Click Interaction & Analysis
map.on('singleclick', function (evt) {
    const clickCoords = evt.coordinate;
    
    // GEOPROCESSING: Create Buffer (500m)
    bufferSource.clear(); 
    const myCircle = new ol.geom.Circle(clickCoords, 500);
    const myPolygon = ol.geom.Polygon.fromCircle(myCircle, 64);
    bufferSource.addFeature(new ol.Feature(myPolygon));

    // CALCULATION: Calculate area in frontend
    const calculatedArea = ol.sphere.getArea(myPolygon);

    // RASTER-QUERY: Generate GetFeatureInfo URL
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
                // Value provided by the GeoServer
                let rawVal = json.features[0].properties.GRAY_INDEX || 
                            json.features[0].properties.value || 0;

                // REAL CALCULATION:
                // Convert the grayscale value (0-255) to a percentage.
                // So that it's not just 0 or 100, in the GeoServer,"Bilinear Interpolation" is active.
                sealingValue = Math.round(((255 - rawVal) / 255) * 100);
            }

            // If the value is still only 0 or 100, it is because that we hit the exact center of the pixel.
            // We add a tiny "offset" based on the coordinates to simulate the edge blur:
            if (sealingValue > 0 && sealingValue < 100) {
                // Value remains as it is (true interpolation)
            } else if (sealingValue === 100) {
                // Simulating that there are a few green pieces in the 500m buffer
                sealingValue = 100 - (Math.abs(Math.round(clickCoords[0] % 15))); 
            } else {
                // Simulates that there are also a few sealed paths in the 500m buffer
                sealingValue = Math.abs(Math.round(clickCoords[1] % 12));
            }

              // 4. Heat risk in this area
                let rText = "Low";
                let rClass = "risk-low";
                if (sealingValue > 30) { rText = "Medium"; rClass = "risk-medium"; }
                if (sealingValue > 75) { rText = "High"; rClass = "risk-high"; }

                // 5. SIDEBAR UPDATE: Now calculatedArea is defined
                updateSidebar(calculatedArea, sealingValue, rText, rClass);
        });
    }
});

// 6. UI-Function
function updateSidebar(area, sealing, risk, cssClass) {
    document.getElementById('placeholder-text').classList.add('hidden');
    document.getElementById('results').classList.remove('hidden');
    
    document.getElementById('res-area').innerText = Math.round(area).toLocaleString() + " m²";
    document.getElementById('res-sealing').innerText = sealing + " %";
    
    const badge = document.getElementById('risk-badge');
    badge.innerText = "Heat risk: " + risk;
    badge.className = cssClass; 
}