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
// 16×9 ASCII grid. Kept deliberately OPEN — enemies have no pathfinding (see
// MAPS-SPRINT caveat), so no enclosed pockets that would trap them or the player.
// 'siege' maps keep their edges clear so off-screen tanks can drive straight in.
const MAPS=[
  { name:'Classic', spawn:'warp', grid:[
    "................",
    ".......##...OO..",
    ".......##...OO..",
    ".....##.........",
    ".....##....OO...",
    "..S.......##....",
    "..OO......##....",
    "......e......e..",
    "................",
  ]},
  { name:'Open Field', spawn:'warp', grid:[
    "................",
    "....###.........",
    "....#O#...C.....",
    "..........C.....",
    ".S.....OO....e..",
    "....C...........",
    "....C.....#O#...",
    "..........###...",
    "................",
  ]},
  { name:'Central Cross', spawn:'warp', grid:[
    "................",
    "................",
    ".......##.......",
    ".....##OO##.....",
    "..S..#O##O#..e..",
    ".....##OO##.....",
    ".......##.......",
    "................",
    "................",
  ]},
  { name:'Four Quadrants', spawn:'warp', grid:[
    "................",
    "..##......##....",
    "..##......##....",
    "................",
    "..S..OOOO....e..",
    "................",
    "..##......##....",
    "..##......##....",
    "................",
  ]},
  { name:'Bank Gallery', spawn:'warp', grid:[
    "................",
    "...##...........",
    "...##.....##....",
    "..........##....",
    "..S.........e...",
    "....##..........",
    "....##.....##...",
    "...........##...",
    "................",
  ]},
  { name:'Hole Gauntlet', spawn:'warp', grid:[
    "................",
    "...OO..OO..OO...",
    "...OO..OO..OO...",
    "................",
    "..S.........e...",
    "................",
    "...OO..OO..OO...",
    "...OO..OO..OO...",
    "................",
  ]},
  { name:'Perimeter Cover', spawn:'warp', grid:[
    "................",
    ".##.....#....##.",
    ".##.....O....##.",
    "........#.......",
    "..S.OO..#.OO.e..",
    "........O.......",
    ".##.....#....##.",
    ".##.....#....##.",
    "................",
  ]},
  { name:'Diagonal Lanes', spawn:'warp', grid:[
    "................",
    "..##............",
    ".....##.........",
    "........##......",
    "..S........##.e.",
    "....##..........",
    ".......##.......",
    "..........##....",
    "................",
  ]},
  // ---- SIEGE (assault→hold): clear the 'H' fortress garrison, then hold the zone
  // while reinforcements pour in from the 'e' edges. Walls are '#' with 'O' slits. ----
  { name:'Redoubt', spawn:'siege', grid:[      // one slit-wall faces the right; open approach + flanks
    "................",
    "..........#.....",
    "..........O..e..",
    "......HH..#.....",
    ".S....HH..O..e..",
    "......HH..#.....",
    "..........O..e..",
    "..........#.....",
    "................",
  ]},
  { name:'Causeway', spawn:'siege', grid:[     // one slit-wall faces the top; open sides + rear
    "................",
    "......e.e.e.....",
    "................",
    "................",
    "................",
    "......#O#O#.....",
    ".......HHH......",
    ".S.....HHH......",
    "................",
  ]},
  { name:'Crossroads', spawn:'siege', grid:[   // short slit-walls flank the center; open top/bottom
    "................",
    "................",
    ".....#....#.....",
    "..e..O.HH.O..e..",
    ".......HH.......",
    "..e..O.HH.O..e..",
    ".....#....#.....",
    "................",
    ".......S........",
  ]},
  { name:'Crate Yard', spawn:'warp', grid:[
    "................",
    "...C...C...C....",
    "................",
    "....##.....##...",
    "..S....C.....e..",
    "....##.....##...",
    "................",
    "...C...C...C....",
    "................",
  ]},
  { name:'Marsh', spawn:'warp', grid:[
    "................",
    "..WW.......WW...",
    "..WW.......WW...",
    "......OOOO......",
    "..S.WW...WW..e..",
    "......OOOO......",
    "..WW.......WW...",
    "..WW.......WW...",
    "................",
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
