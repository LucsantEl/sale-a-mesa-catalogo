# Descarga portadas de juegos desde BoardGameGeek (BGG) usando su API pública.
# Tanda 2: juegos agregados después del lote inicial.
$ErrorActionPreference = "SilentlyContinue"
$outDir = "C:\Users\CESAR\Documents\sale-a-mesa-catalogo\images"

$games = @{
  "finspan" = "Finspan"
  "dice-forge" = "Dice Forge"
  "fromage" = "Fromage"
  "resident-evil-2" = "Resident Evil 2: The Board Game"
  "critter-kitchens" = "Critter Kitchens"
  "last-bastion" = "Last Bastion"
  "paleo" = "Paleo"
  "flamecraft" = "Flamecraft"
  "trekking-through-history" = "Trekking Through History"
  "arkham-horror-tcg" = "Arkham Horror: The Card Game"
  "feed-the-kraken" = "Feed the Kraken"
  "hive" = "Hive"
  "street-fighter-board-game" = "Street Fighter: The Board Game"
  "trio" = "Trio"
  "funfair" = "Funfair"
  "el-gato-en-la-torre" = "The Cat in the Tower"
  "turing-machine" = "Turing Machine"
  "fairy-tile" = "Fairy Tile"
  "neotopia" = "Neotopia"
  "world-of-wonders" = "World of Wonders"
  "party-panda-pirates" = "Party Panda Pirates"
  "twisted-cryptids" = "Twisted Cryptids"
  "sail" = "Sail"
  "palabra-pirata" = "Pirate Words"
  "hawaiki" = "Hawaiki"
  "la-cuenta" = "La Cuenta"
  "exploradores-del-bosque" = "Forest Explorers"
  "virus" = "Virus!"
  "coffee-rush" = "Coffee Rush"
  "paint-the-roses" = "Paint the Roses"
  "art-society" = "Art Society"
  "rescate" = "Rescue"
  "nictofobia" = "Nyctophobia"
  "wayfinders" = "Wayfinders"
  "whistle-stop" = "Whistle Stop"
  "diamant" = "Diamant"
  "prehistorias" = "Prehistories"
  "meeple-circus" = "Meeple Circus"
  "park-royale" = "Park Royale"
}

$headers = @{ "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
$results = @()

foreach ($slug in $games.Keys) {
  $query = $games[$slug]
  $outFile = Join-Path $outDir "$slug.png"
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

$results | Out-File -FilePath "C:\Users\CESAR\Documents\sale-a-mesa-catalogo\fetch-log-2.txt" -Encoding utf8
$results
