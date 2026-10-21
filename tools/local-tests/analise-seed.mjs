// Semeia o Postgres de teste com lotes avaliados (lots, lot_ai, lot_market, lot_condition) para a
// página /analise. Usa o psql do ambiente (PGHOST/PGPORT/PGUSER/PGDATABASE/PGPASSWORD).
import { execFileSync } from "node:child_process";

const psql = (q) => execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-q", "-c", q], { stdio: "inherit" });
const q = (s) => String(s).replace(/'/g, "''");
const today = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()) + "T12:00:00Z");
const day = (n) => new Date(today.getTime() + n * 86_400_000).toISOString().slice(0, 10);

// artista, álbum, ano, casa, UF, dia (0 = hoje), horário, preço, nota, raridade, sugerido, disco, capa, want, have, lances
const ROWS = [
  ["Tim Maia", "Tim Maia", 1970, "Casa Alfa Leilões", "SP", 0, "19:30h", "R$ 180,00", 94, "muito_raro", 520, "VG+", "VG", 1840, 920, 6],
  ["Os Mutantes", "A Divina Comédia ou Ando Meio Desligado", 1970, "Beta Leilões", "RJ", 0, "18:00h", "R$ 95,00", 88, "raro", 340, "VG", "VG", 1320, 760, 3],
  ["Pink Floyd", "The Dark Side of the Moon", 1973, "Gama Antiguidades", "MG", 0, "20:15h", "R$ 140,00", 55, "interessante", 190, "VG", "G+", 4200, 6100, 9],
  ["Jorge Ben", "Força Bruta", 1970, "Casa Alfa Leilões", "SP", 0, "19:30h", "R$ 60,00", 81, "raro", 210, "VG+", "VG+", 610, 340, 2],
  ["Milton Nascimento", "Clube da Esquina", 1972, "Delta Leilões", "SP", 0, "21:00h", "R$ 210,00", 90, "muito_raro", 480, "VG", "G+", 2100, 1250, 8],
  ["Rita Lee", "Fruto Proibido", 1975, "Beta Leilões", "RJ", 1, "18:00h", "R$ 45,00", 72, "interessante", 120, "VG+", "VG", 540, 880, 1],
  ["Led Zeppelin", "IV", 1971, "Delta Leilões", "SP", 1, "20:00h", "R$ 300,00", 40, "comum", 260, "VG+", "VG+", 5100, 7300, 12],
  ["Secos & Molhados", "Secos & Molhados", 1973, "Casa Alfa Leilões", "SP", 1, "19:30h", "R$ 110,00", 83, "raro", 300, "G+", "G", 980, 710, 4],
];

psql("delete from lots; delete from lot_ai; delete from lot_market; delete from lot_condition; delete from lot_sales;");
ROWS.forEach(([artist, album, year, house, uf, d, time, price, score, rar, sugg, media, sleeve, want, have, bids], i) => {
  const id = `9000${i}-1000${i}`;
  const title = `LP ${artist} - ${album} ${year}`;
  const byCond = JSON.stringify({ VG: sugg * 0.85, "VG+": sugg, "G+": sugg * 0.7, NM: sugg * 1.2 });
  psql(`insert into lots(id,id_leilao,id_peca,base,lote,title,url,image,price,day_key,start_time,uf,house,house_url,artist)
    values('${id}','9000${i}','1000${i}','https://www.leiloesbr.com.br','${10 + i}','${q(title)}','https://example.com/peca.asp?ID=1000${i}',null,'${price}','${day(d)}','${time}','${uf}','${q(house)}','https://example.com','${q(artist)}')`);
  psql(`insert into lot_ai(id,title_hash,score,rarity,deal,album,reason,tags)
    values('${id}','h',${score},'${rar}','justo','${q(artist)} - ${q(album)} (${year})','Motivo de teste ${i}','["teste"]')`);
  psql(`insert into lot_market(id,basis,matched,release_id,release_title,year,num_for_sale,lowest_price,currency,suggested_price,suggested_condition,have,want,price_low_br,price_high_br,num_for_sale_br,suggested_by_condition)
    values('${id}','m2:x',true,${500 + i},'${q(album)}',${year},10,${sugg * 0.8},'BRL',${sugg},'VG+',${have},${want},${sugg * 0.9},${sugg * 1.4},3,'${byCond}')`);
  psql(`insert into lot_condition(id,title_hash,media,sleeve,insert_state,score,faixa,source,views,bids)
    values('${id}','c','${media}','${sleeve}','sim',70,'Bom','regex',200,${bids})`);
});
// Vendas passadas (Analytics) de dois discos: Tim Maia (4 vendas) e Rita Lee (3).
const SALES = [
  ["Tim Maia", "Tim Maia", [380, 610, 640, 880]],
  ["Rita Lee", "Fruto Proibido", [70, 105, 160]],
];
SALES.forEach(([artist, album, prices], k) =>
  prices.forEach((p, j) =>
    psql(`insert into lot_sales(lot_id,id_leilao,id_peca,artist,title,sold_price,sold_price_raw,sold_date,house,uf,media,sleeve,score)
      values('8000${k}-2000${j}','8000${k}','2000${j}','${q(artist)}','${q(artist)} - ${q(album)}',${p},'R$ ${p},00','2026-09-${10 + j}','Casa Antiga','SP','VG+','VG',70)`),
  ),
);
console.log(`semeados ${ROWS.length} lotes`);
