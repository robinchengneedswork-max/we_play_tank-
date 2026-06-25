"use strict";
// maps — tile-based arena definitions + collision-rect baking.
// A map is authored as an ASCII tilemap (array of equal-length strings, one char
// per cell). The grid exists only to author + collide; it is never drawn.
// Legend: '.' floor · '#' block · 'O' hole (M1) · 'S' player spawn · 'e' enemy zone.
// Authoring grid is 16×9 (landscape-first); the outer wall is the engine FRAME,
// so maps carry no border row.

const TILE = { FLOOR:'.', BLOCK:'#', HOLE:'O', WATER:'W', CRATE:'C', SPAWN:'S', ENEMY:'e', HOLD:'H' };
const CRATE_HP = 2;              // shots a crate takes before it breaks (M3)
// On SIEGE maps: 'H' marks the hold zone (the fortress you capture + defend);
// 'e' cells mark the edge(s) reinforcements pour in from (so maps can be linear).

// Map library (M2). Each map: name, spawn style ('warp' default | 'siege'), and a
// 16×9 ASCII grid. TACTICAL — cut-off geometry (U's, chokepoints, one-gap walls) is
// WANTED: isolating fights is part of the combat puzzle, and a tank that can't reach
// the player now IDLE-WANDERS instead of stacking in a corner (see _stuckMs / idle
// wander in logic.js), so concave pockets and long walls are fair game. Still: keep
// the player's spawn reachable and don't fully seal a room the player must escape.
// HOLES ('O') stay the most elegant divider — they split MOVEMENT but never block
// line-of-sight or the AI's aim, so bots behind one still shoot back. Gaps a tank
// passes through want >=2 cells (one tank-width is ~1 cell). 'siege' maps keep their
// edge approaches open so off-screen reinforcements can drive in.
const MAPS=[
  // Two soft rooms split by a broken central spine; cross at the middle, bank off
  // the spine, peek-shoot over the centre holes.
  { name:'Classic', spawn:'warp', grid:[
    "................",
    ".......##.......",
    ".......##.......",
    "....O.......O...",
    "..S....OO....e..",
    "....O.......O...",
    ".......##.......",
    ".......##.......",
    "................",
  ]},
  // Central divider (block teeth + hole slits) → two rooms joined by three gates
  // (top edge / centre / bottom edge). The classic "couple of rooms" split.
  { name:'Twin Rooms', spawn:'warp', grid:[
    "................",
    ".......##.......",
    ".......OO.......",
    ".......##.......",
    "..S.........e...",
    ".......##.......",
    ".......OO.......",
    ".......##.......",
    "................",
  ]},
  // Four wall-posts frame a central chamber → four corner rooms; fight in/around
  // the middle, bank off the gate posts.
  { name:'Central Cross', spawn:'warp', grid:[
    "................",
    "......#..#......",
    "......#..#......",
    "................",
    "..S..#.OO.#..e..",
    "................",
    "......#..#......",
    "......#..#......",
    "................",
  ]},
  // A hole CROSS carves four rooms — movement funnels to the centre crossroads +
  // edge lanes, but the AI sees/shoots across every quadrant (holes never blind it).
  { name:'Four Quadrants', spawn:'warp', grid:[
    "................",
    ".......OO.......",
    "...#...OO...#...",
    ".......OO.......",
    "..S.OO....OO.e..",
    ".......OO.......",
    "...#...OO...#...",
    ".......OO.......",
    "................",
  ]},
  // Twin diagonal funnels pinching at a centre block — a gallery for bouncing
  // shells around the staircases to hit what's hiding behind them.
  { name:'Bank Gallery', spawn:'warp', grid:[
    "................",
    "...##......##...",
    "....##....##....",
    ".....##..##.....",
    "..S....##....e..",
    ".....##..##.....",
    "....##....##....",
    "...##......##...",
    "................",
  ]},
  // Shoot-over lanes: six hole pillars + two bank blocks, wide open midband.
  { name:'Hole Gauntlet', spawn:'warp', grid:[
    "................",
    "..OO..OO..OO....",
    "..OO..OO..OO....",
    "................",
    "..S..#....#..e..",
    "................",
    "..OO..OO..OO....",
    "..OO..OO..OO....",
    "................",
  ]},
  // Inverse map: cover hugs the perimeter (corner forts), the centre is the killing
  // floor with a peek-over hole column down the middle.
  { name:'Perimeter Cover', spawn:'warp', grid:[
    "................",
    ".##.........##..",
    ".##....OO...##..",
    ".......OO.......",
    "..S.........e...",
    ".......OO.......",
    ".##....OO...##..",
    ".##.........##..",
    "................",
  ]},
  // Two leaky diagonal block-lines slash the field into three weaving lanes —
  // single blocks so tanks slip the corners; endless bank angles.
  { name:'Diagonal Lanes', spawn:'warp', grid:[
    "................",
    "..#......#......",
    "...#......#.....",
    "....#......#....",
    "..S..#......#.e.",
    "......#......#..",
    ".......#......#.",
    "........#......#",
    "................",
  ]},
  // ---- SIEGE (assault→hold): clear the 'H' garrison, then HOLD the zone while
  // reinforcements pour in from the 'e' edges. The approach is LAYERED — staggered
  // teeth + slits give the defender chokepoint/bank moments — but flanks stay OPEN
  // (no full walls) so attackers weave through instead of piling, with no pathfinding. ----
  { name:'Redoubt', spawn:'siege', grid:[      // fortress on the left; attackers cross 2 cover layers from the right
    "................",
    "............#.e.",
    "..HH...##.......",
    "..HH.......O..e.",
    ".SHH...##....O..",
    "..HH.......O..e.",
    "..HH...##.......",
    "............#.e.",
    "................",
  ]},
  { name:'Causeway', spawn:'siege', grid:[     // attackers pour from the top and run a baffled isthmus to the keep
    "................",
    "..e...e...e...e.",
    "................",
    "...##......##...",
    "......#..#......",
    "................",
    "....#OHHHHO#....",
    ".....SHHHH......",
    "................",
  ]},
  { name:'Crossroads', spawn:'siege', grid:[   // a central keep with slit-walls; attackers converge from top + both sides
    ".......e........",
    "....##......##..",
    "......#OO#......",
    "e....O....O....e",
    "......HHHH......",
    "......HHHH......",
    "......#OO#......",
    "....##......##..",
    ".......S........",
  ]},
  // Destructible rooms: blast your own sightlines through the crate walls. Two solid
  // anchors keep some permanent bank geometry; crates self-clear so nothing stays trapped.
  { name:'Crate Yard', spawn:'warp', grid:[
    "................",
    "...CC....CC.....",
    "...CC....CC.....",
    "................",
    "..S...CCCC...e..",
    "................",
    "...CC....CC.....",
    "...CC....CC.....",
    "................",
  ]},
  // Pure terrain texture — water + holes only, zero LOS blockers, so it's a movement
  // puzzle with no trap risk at all: weave the wet ground while everyone can see across.
  { name:'Marsh', spawn:'warp', grid:[
    "................",
    ".WW.......OO....",
    ".WW.......OO....",
    "................",
    "..S.OO...OO..e..",
    "................",
    "....WW.......WW.",
    "....WW.......WW.",
    "................",
  ]},
  // ---- Wii Play "Tanks!" TRIBUTES — the iconic mission archetypes, rebuilt with our
  // palette: cork(destructible)=C, wood(solid)=#, holes=O. NOT pixel-exact rips: the
  // real game's bots had pathfinding, ours don't, so silhouettes are kept open-flanked
  // (gaps >=2 cells, no hollow solid boxes) so our AI weaves instead of wedging. ----
  { name:'First Sortie', spawn:'warp', grid:[   // M1 vibe: near-empty opener, two offset blocks
    "................",
    "................",
    "......##........",
    "......##........",
    "..S.........e...",
    "........##......",
    "........##......",
    "................",
    "................",
  ]},
  { name:'Cork Cross', spawn:'warp', grid:[      // central destructible plus — blast your own lanes
    "................",
    ".......C........",
    ".......C........",
    ".....CCCCC......",
    "..S..CC.CC...e..",
    ".....CCCCC......",
    ".......C........",
    ".......C........",
    "................",
  ]},
  { name:'Hole Crossing', spawn:'warp', grid:[   // four pits, open cross lanes — snipe across the gaps
    "................",
    "...OOOO..OOOO...",
    "...OOOO..OOOO...",
    "................",
    "..S.........e...",
    "................",
    "...OOOO..OOOO...",
    "...OOOO..OOOO...",
    "................",
  ]},
  { name:'The Citadel', spawn:'warp', grid:[     // solid central keep you circle + bank around; cork outliers
    "................",
    "...C........C...",
    ".....####.......",
    ".....####.......",
    "..S..####....e..",
    ".....####.......",
    ".....####.......",
    "...C........C...",
    "................",
  ]},
  { name:'Three Lanes', spawn:'warp', grid:[     // twin wood walls (hole slits) → three corridors joined top/middle/bottom
    "................",
    ".....#....#.....",
    ".....#....#.....",
    "................",
    "..S..O....O..e..",
    "................",
    ".....#....#.....",
    ".....#....#.....",
    "................",
  ]},
  // ---- "PICK YOUR FIGHTS" — bolder cut-off geometry, now that stuck tanks idle-wander
  // instead of corner-stacking. Enemies that can't reach you mill on the far side; you
  // choose when to round the wall and take them one lane at a time. ----
  { name:'Horseshoe', spawn:'warp', grid:[       // a C-redoubt open to the player's side; enemies must come around the ends
    "................",
    ".....######.....",
    ".........##.....",
    ".........##.....",
    "..S......##..e..",
    ".........##.....",
    ".........##.....",
    ".....######.....",
    "................",
  ]},
  { name:'Pinch', spawn:'warp', grid:[           // two arenas, one central chokepoint — funnel them through one at a time
    ".......##.......",
    ".......##.......",
    ".......##.......",
    "................",
    "..S.........e...",
    "................",
    ".......##.......",
    ".......##.......",
    ".......##.......",
  ]},
];

// Greedy-merge all cells of char `ch` into the fewest axis-aligned rectangles
// (in CELL space). Merging avoids the per-cell collision seams that would snag
// tanks and shells on tile borders.
function mergeCellRects(grid, ch){
  const R=grid.length, C=grid[0].length;
  const used=Array.from({length:R},()=>new Array(C).fill(false));
  const free=(c,r)=> grid[r][c]===ch && !used[r][c];
  const rects=[];
  for(let r=0;r<R;r++) for(let c=0;c<C;c++){
    if(grid[r][c]!==ch || used[r][c]) continue;
    let w=1; while(c+w<C && free(c+w,r)) w++;          // extend right
    let h=1;                                            // extend down while the full strip is free
    grow: while(r+h<R){
      for(let k=0;k<w;k++) if(!free(c+k,r+h)) break grow;
      h++;
    }
    for(let rr=r;rr<r+h;rr++) for(let cc=c;cc<c+w;cc++) used[rr][cc]=true;
    rects.push({c,r,w,h});
  }
  return rects;
}

// Parse a map def → cell-space collision rects + spawn cells. Resolution-
// independent; projectMap() turns the cell rects into pixel blockRects on resize.
function buildMap(def){
  const grid=def.grid, C=grid[0].length, R=grid.length;
  const blockCells=mergeCellRects(grid, TILE.BLOCK);
  const holeCells =mergeCellRects(grid, TILE.HOLE);
  const waterCells=mergeCellRects(grid, TILE.WATER);
  const crateCells=mergeCellRects(grid, TILE.CRATE);
  const holdCells =mergeCellRects(grid, TILE.HOLD);
  let playerCell=null; const enemyCells=[];
  for(let r=0;r<R;r++) for(let c=0;c<C;c++){
    const ch=grid[r][c];
    if(ch===TILE.SPAWN) playerCell={c,r};
    else if(ch===TILE.ENEMY) enemyCells.push({c,r});
  }
  return { def, C, R, blockCells, holeCells, waterCells, crateCells, holdCells, playerCell, enemyCells };
}

let currentMap = buildMap(MAPS[0]);

// Project the current map's cell rects onto the playfield (FRAME-inset) at the
// live canvas size. Called from resize() — cells stretch to fit any screen, so
// authored layouts stay consistent across phone and laptop.
function projectMap(){
  if(!currentMap || !W || !H) return;
  const cw=(W-2*FRAME)/currentMap.C, chh=(H-2*FRAME)/currentMap.R;
  const bake=cells=>cells.map(b=>({ x:FRAME+b.c*cw, y:FRAME+b.r*chh, w:b.w*cw, h:b.h*chh }));
  blockRects.length=0; for(const r of bake(currentMap.blockCells)) blockRects.push(r);
  holeRects.length=0;
  for(const r of bake(currentMap.holeCells))  holeRects.push(r);
  for(const r of bake(currentMap.waterCells)){ r.water=true; holeRects.push(r); }   // water = hole (move-block) with a wet look
  crates.length=0;
  for(const r of bake(currentMap.crateCells)){ r.crate=true; r.hp=CRATE_HP; r.max=CRATE_HP; crates.push(r); }
  // hold zone = pixel bounding box of all 'H' cells (siege only; null otherwise)
  holdRect=null;
  if(currentMap.holdCells.length){
    let mnc=1e9,mnr=1e9,mxc=-1e9,mxr=-1e9;
    for(const b of currentMap.holdCells){ mnc=Math.min(mnc,b.c); mnr=Math.min(mnr,b.r); mxc=Math.max(mxc,b.c+b.w); mxr=Math.max(mxr,b.r+b.h); }
    holdRect={ x:FRAME+mnc*cw, y:FRAME+mnr*chh, w:(mxc-mnc)*cw, h:(mxr-mnr)*chh };
  }
}

// Select a map (for M2 rotation / sandbox cycling) and re-project at current size.
function loadMap(def){ currentMap=buildMap(def); projectMap(); }

// Pixel center of a grid cell at the live canvas size.
function cellToPx(cell){
  const cw=(W-2*FRAME)/currentMap.C, chh=(H-2*FRAME)/currentMap.R;
  return { x:FRAME+(cell.c+0.5)*cw, y:FRAME+(cell.r+0.5)*chh };
}
// Player spawn for the current map (its 'S' cell, or a sensible default).
function mapPlayerSpawn(){
  return currentMap.playerCell ? cellToPx(currentMap.playerCell) : { x:W*0.16, y:H*0.6 };
}

// Map rotation — a shuffled bag so every map shows before any repeats, and the
// first map of a fresh bag never equals the last one played (no immediate repeat).
let mapBag=[], lastMapIdx=-1;
function loadNextMap(){
  if(mapBag.length===0){
    mapBag=MAPS.map((_,i)=>i);
    for(let i=mapBag.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [mapBag[i],mapBag[j]]=[mapBag[j],mapBag[i]]; }
    if(mapBag.length>1 && mapBag[mapBag.length-1]===lastMapIdx) [mapBag[0],mapBag[mapBag.length-1]]=[mapBag[mapBag.length-1],mapBag[0]];
  }
  lastMapIdx=mapBag.pop();
  loadMap(MAPS[lastMapIdx]);
}
