# Descarga portadas de juegos desde BoardGameGeek (BGG) usando su API pública.
$ErrorActionPreference = "SilentlyContinue"
$outDir = "C:\Users\CESAR\Documents\sale-a-mesa-catalogo\images"

# slug => término de búsqueda en BGG (nombre en inglés cuando aplica)
$games = @{
  "secret-hitler" = "Secret Hitler"
  "golpe-de-fe" = "Faith"
  "el-bucle" = "The Loop"
  "el-despertar" = "The Awakening"
  "creature-comforts" = "Creature Comforts"
  "colt-express" = "Colt Express"
  "burgle-brothers-2" = "Burgle Bros 2"
  "heat" = "Heat: Pedal to the Metal"
  "pandemic" = "Pandemic"
  "codigo-secreto" = "Codenames"
  "un-dia-en-las-carreras" = "A Day at the Races"
  "dig-your-way-out" = "Dig Your Way Out"
  "villainous" = "Disney Villainous"
  "dixit" = "Dixit"
  "incomodos-invitados-2" = "Awkward Guests: The Beswick Case"
  "camera-roll" = "Camera Roll"
  "toy-battle" = "Toy Battle"
  "stranger-things" = "Stranger Things: The Board Game"
  "chandigarh" = "Chandigarh"
  "wavelength" = "Wavelength"
  "knockdown" = "Knockdown"
  "volver-al-futuro" = "Back to the Future: Back in Time"
  "5-minute-mystery" = "5 Minute Mystery"
  "tapestry" = "Tapestry"
  "alone" = "Alone"
  "catan" = "Catan"
  "zombicide-black-plague" = "Zombicide: Black Plague"
  "masters-of-the-universe" = "Masters of the Universe: Battle for Eternia"
  "endeavor" = "Endeavor: Age of Sail"
  "kemet" = "Kemet"
  "cyclades" = "Cyclades"
  "western-legends" = "Western Legends"
  "teotihuacan" = "Teotihuacan: City of Gods"
  "narcos" = "Narcos: The Board Game"
  "dead-reckoning" = "Dead Reckoning"
  "el-padrino" = "The Godfather: Corleone's Empire"
  "grimm-forest" = "The Grimm Forest"
  "pequenos-grandes-misterios" = "Tiny Detectives"
  "betrayal-house-on-the-hill" = "Betrayal at House on the Hill"
  "laberinto-magico" = "Labyrinth"
  "camel-up" = "Camel Up"
  "mansiones-de-la-locura" = "Mansions of Madness: Second Edition"
  "fabulas-de-peluche" = "Stuffed Fables"
  "survive" = "Survive: Escape from Atlantis!"
  "takenoko" = "Takenoko"
  "photosynthesis" = "Photosynthesis"
  "dorfromantik" = "Dorfromantik: The Board Game"
  "scout" = "Scout"
  "rhino-hero" = "Rhino Hero"
  "similo" = "Similo"
  "sushi-go" = "Sushi Go!"
  "iq-files" = "IQ Files"
  "bang" = "BANG!"
  "fantasma-blitz" = "Geistesblitz"
  "sea-salt-paper" = "Sea Salt & Paper"
  "salem-1692" = "Salem 1692"
  "3-ring-circus" = "3 Ring Circus"
  "sheriff-de-nottingham" = "Sheriff of Nottingham"
  "sky-team" = "Sky Team"
  "harmonies" = "Harmonies"
}

$headers = @{ "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
$results = @()

foreach ($slug in $games.Keys) {
  $query = $games[$slug]
  $outFile = Join-Path $outDir "$slug.jpg"
  try {
    $searchUrl = "https://boardgamegeek.com/xmlapi2/search?type=boardgame&query=" + [uri]::EscapeDataString($query)
    [xml]$searchXml = Invoke-RestMethod -Uri $searchUrl -TimeoutSec 15 -Headers $headers
    $id = $searchXml.items.item | Select-Object -First 1 -ExpandProperty id
    if (-not $id) {
      $results += "$slug => NOT FOUND ($query)"
      continue
    }
    $thingUrl = "https://boardgamegeek.com/xmlapi2/thing?id=$id"
    [xml]$thingXml = Invoke-RestMethod -Uri $thingUrl -TimeoutSec 15 -Headers $headers
    $imgUrl = $thingXml.items.item.image
    if (-not $imgUrl) {
      $results += "$slug => NO IMAGE ($query, id=$id)"
      continue
    }
    Invoke-WebRequest -Uri $imgUrl -OutFile $outFile -TimeoutSec 20 -Headers $headers
    $results += "$slug => OK ($query, id=$id)"
  } catch {
    $results += "$slug => ERROR ($query): $($_.Exception.Message)"
  }
  Start-Sleep -Milliseconds 600
}

$results | Out-File -FilePath "C:\Users\CESAR\Documents\sale-a-mesa-catalogo\fetch-log.txt" -Encoding utf8
$results
