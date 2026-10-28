import { describe, expect, test } from "bun:test";

import {
  trackedAuctionStatus,
  decodeHtmlEntities,
  extractArtist,
  collectionNeedsIdentification,
  isCompactsBundle,
  isDiscBundle,
  isLotePassed,
  UNCLASSIFIED_LABEL,
  isVinylTitle,
  splitRecordSpec,
  laterAuctionSlot,
  looksNonVinyl,
  lotOpenUrl,
  normalizeForMatch,
  parsePrice,
  pickCanonical,
  titleCase,
  isSelfTitledAlbum,
  sameAlbumYear,
  extractLooseYear,
  isGenericArtist,
} from "@/lib/vinyl-parse";

describe("vinil x não-vinil", () => {
  test("títulos de vinil", () => {
    expect(isVinylTitle("Compacto Beatles - Help")).toBe(true);
    expect(isVinylTitle("Disco de Vinil Raul Seixas - Krig-ha, Bandolo!")).toBe(true);
  });
  test("ficha Fabricação/Ano/Capa/Mídia sem LP/vinil no título (Disco de Vinil)", () => {
    expect(
      isVinylTitle(
        "California Jam 2 | Fabricação: Estados Unidos | Ano: 1978 | Capa: MB / Mídia: ...",
      ),
    ).toBe(true);
    expect(
      isVinylTitle(
        "Camisa De Vênus - Viva | Fabricação: Brasil | Ano: 1986 | Capa: MB / Mídia: MB",
      ),
    ).toBe(true);
    expect(isVinylTitle("Relógio de pulso | Fabricação: Suíça | Ano: 1970")).toBe(false);
    expect(isVinylTitle("Fita K7 Legião | Capa: MB / Mídia: MB")).toBe(false);
  });
  test("ficha Álbum/Código (Abreu, Vinil 11) sem LP/vinil/disco; CD e LD seguem fora", () => {
    expect(
      isVinylTitle("Álbum: Cartola | Código: 33295-1 | Artista(s): [`Cartola`] | Ano: 2017"),
    ).toBe(true);
    expect(
      isVinylTitle("Álbum duplo : Fascinação | Código: 836 844-1 | Artista(s): Elis Regina"),
    ).toBe(true);
    expect(
      isVinylTitle("Álbum: Deita & Rola | Código: CD 8045-2 | Artista(s): [`Deita & Rola`]"),
    ).toBe(false);
    expect(
      isVinylTitle("Álbum: Heitor Villa-Lobos | Código: LD 5813 | Artista(s): [`Heitor`]"),
    ).toBe(false);
  });
  test("títulos que não são disco", () => {
    expect(looksNonVinyl("CD Caetano Veloso - Transa")).toBe(true);
    expect(looksNonVinyl("Vitrola antiga Philips")).toBe(true);
    expect(looksNonVinyl("LD - Cher N/D; Disco e capa em bons estado.")).toBe(true);
    expect(looksNonVinyl("Laser Disc Buddy Holly Story")).toBe(true);
    expect(isVinylTitle("LD - The Buddy Holly Story (1995); Disco e capa em bons estado.")).toBe(
      false,
    );
    expect(looksNonVinyl("LP Cher - Heart of Stone")).toBe(false);
  });
});

describe("homônimos e ano", () => {
  test("isSelfTitledAlbum", () => {
    expect(isSelfTitledAlbum("Caetano Veloso", "Caetano Veloso")).toBe(true);
    expect(isSelfTitledAlbum("Caetano Veloso", "Transa")).toBe(false);
    expect(isSelfTitledAlbum("Caetano Veloso", "")).toBe(false);
  });
  test("sameAlbumYear: só o homônimo de anos diferentes vira outro disco", () => {
    expect(sameAlbumYear("Caetano Veloso", "Caetano Veloso", 1968, 1986)).toBe(false);
    expect(sameAlbumYear("Caetano Veloso", "Caetano Veloso", 1968, null)).toBe(true);
    expect(sameAlbumYear("Caetano Veloso", "Caetano Veloso", 1986, 1986)).toBe(true);
    expect(sameAlbumYear("Pink Floyd", "The Wall", 1979, 2011)).toBe(true); // reedição
  });
  test("extractLooseYear: ano solto em qualquer ponto da linha", () => {
    const y = (s: string) => extractLooseYear(s);
    expect(y("caetano veloso - caetano veloso 1968")).toEqual({
      year: 1968,
      rest: "caetano veloso - caetano veloso",
    });
    expect(y("Caetano Veloso 1968 - Caetano Veloso")).toEqual({
      year: 1968,
      rest: "Caetano Veloso - Caetano Veloso",
    });
    expect(y("caetano veloso 1968")).toEqual({ year: 1968, rest: "caetano veloso" });
    expect(y("Caetano Veloso - Caetano Veloso - 1968")).toEqual({
      year: 1968,
      rest: "Caetano Veloso - Caetano Veloso",
    });
    // O ano é o próprio álbum / a linha toda / não há ano.
    expect(y("Prince - 1999")).toBeNull();
    expect(y("1984 - Van Halen")).toBeNull();
    expect(y("1999")).toBeNull();
    expect(y("Chico Buarque - Construção")).toBeNull();
    expect(y("Raul Seixas - Gita 12345")).toBeNull();
  });
});

describe("isDiscBundle — o que NÃO é lote (títulos reais do site)", () => {
  test('todo item é um "lote": a palavra no texto do anúncio não faz conjunto', () => {
    const boomShack =
      "LP ÓTIMO ESTADO álbum 'Boom Shack A Lack', de Junior Reid, produzido por Prince Jammy; contém 10 faixas distribuídas em dois lados. Ambos os exemplares estão sem encarte. Estado geral conforme descrição do lote. bolachão, long play, fonograma, álbum de vinil, pressing, gravação em disco, record, bolacha";
    expect(isDiscBundle(boomShack)).toBe(false);
    expect(extractArtist(boomShack)).toBe("Junior Reid");
    expect(isDiscBundle("Lp X |Em bom estado.| Verifique as imagens deste lote e disco")).toBe(
      false,
    );
    expect(isDiscBundle("LP Fulano - conforme demonstrado nas imagens do lote, disco VG")).toBe(
      false,
    );
  });
  test('"vários artistas" é coletânea de um disco, não conjunto', () => {
    expect(isDiscBundle("LP YO RAP VOLUME 2 VÁRIOS ARTISTAS 1990 LP PARA DJS COM COLETÂNEA")).toBe(
      false,
    );
    expect(
      isDiscBundle("LP Minas São Várias |Em bom estado.| Classificação técnica: disco vg+"),
    ).toBe(false);
    expect(
      isDiscBundle(
        "LP Série Super Erótica, que teve diversos volumes lançados, disco em ótimo estado",
      ),
    ).toBe(false);
  });
  test("número do título/formato, singular ou colado, não é quantidade", () => {
    expect(isDiscBundle("DISCO LP XUXA 6 DISCO LP SEM TESTE")).toBe(false);
    expect(isDiscBundle("LP BRASILEIRO 12 POLEGADAS 33 RPM catálogo 521lp")).toBe(false);
    expect(isDiscBundle("COMPACTO BEATLES odeon 33 compacto número de catálogo 7ID")).toBe(false);
  });
  test("coleção de discos só vale no início; no meio é prosa", () => {
    expect(isDiscBundle("Coleção de discos Beatles")).toBe(true);
    expect(isDiscBundle("LP Raro, pronto para integrar uma coleção de discos importados")).toBe(
      false,
    );
  });
  test("lotes de verdade continuam sendo lote", () => {
    expect(isDiscBundle("Lote com quatro discos de vinil long play de música sertaneja")).toBe(
      true,
    );
    expect(isDiscBundle("Lote de Quatro discos de vinil long play contendo álbuns")).toBe(true);
    expect(isDiscBundle("Lote surpresa de vinis variados")).toBe(true);
    expect(isDiscBundle("BOX 4 LPS SELEÇÃO DUCAL")).toBe(true);
    expect(isDiscBundle("150 discos diversos")).toBe(true);
    expect(isDiscBundle("Lote de máximo apelo para design de interiores, vinil gigante raro")).toBe(
      false,
    );
  });
});

describe("isCompactsBundle (3+ compactos avulsos sem a palavra lote)", () => {
  test("vão para não classificados, sem artista", () => {
    const t = "VINIL: 3 COMPACTOS: NEY MATOGROSSO, ROBERTO CARLOS E ALTEMART DUTRA. BOM";
    expect(isDiscBundle(t)).toBe(true);
    expect(isCompactsBundle(t)).toBe(true);
    expect(extractArtist(t)).toBe("");
  });
  test('com a palavra "lote" segue sendo Lote', () => {
    const t = "LOTE COM 5 COMPACTOS CURSO DE INGLÊS AUDIOVISUAL";
    expect(isCompactsBundle(t)).toBe(false);
    expect(extractArtist(t)).toBe("Lote");
  });
});

describe("isDiscBundle", () => {
  test("lotes com vários discos", () => {
    expect(isDiscBundle("Lote com 10 LPs")).toBe(true);
    expect(isDiscBundle("5 discos de vinil MPB")).toBe(true);
    expect(isDiscBundle("três LPs de rock")).toBe(true);
    expect(isDiscBundle("150 discos diversos")).toBe(true);
    expect(isDiscBundle("Coleção de discos Beatles")).toBe(true);
  });
  test("disco único (inclui duplo e nº de lote no início)", () => {
    expect(isDiscBundle("2 LPs Pink Floyd The Wall")).toBe(false);
    expect(isDiscBundle("Lote 09 vinil único Chico")).toBe(false);
  });
  test("chamariz/ficha de estado de casa não faz o disco virar lote", () => {
    const t =
      "ALERTA RARIDADE LOTE ESPECIAL DE FECHAMENTO Lp Trajeto Vitor Assis Brasil |Em bom estado.| Classificação técnica: capa vg+/ disco nm";
    expect(isDiscBundle(t)).toBe(false);
    expect(extractArtist("ALERTA RARIDADE Lp Adoniram Barbosa |Em bom estado.|")).toBe(
      "Adoniram Barbosa",
    );
    expect(
      isDiscBundle(
        "ALERTA RARIDADE Lp Batatinha |Em bom estado.| Classificação técnica: lote de discos",
      ),
    ).toBe(false);
    expect(isDiscBundle("ALERTA RARIDADE Lote com 10 LPs")).toBe(true);
  });
  test("ano colado no formato não é quantidade", () => {
    expect(isDiscBundle("LP Vinil Chico Buarque - Construção 1971 Disco VG+ Capa VG")).toBe(false);
  });
});

describe("extractArtist — títulos em prosa e cabeçalhos de formato", () => {
  const cases: [string, string][] = [
    [
      'Disco de vinil de 12 polegadas, 33 rpm, da cantora Thelma Houston, álbum "Ready to Roll", lançado pelo selo Tamla',
      "Thelma Houston",
    ],
    [
      'Disco de vinil de 12 polegadas, LP do grupo Shalamar, álbum "Friends", lançado pelo selo Solar',
      "Shalamar",
    ],
    [
      'Disco de vinil, formato LP, da artista Roberta Kelly, álbum "Zodiac Lady". Selo RGE',
      "Roberta Kelly",
    ],
    [
      "LP de vinil da cantora Celeste, lançado pelo selo Pentagrama (referência LP PEN 001 A)",
      "Celeste",
    ],
    [
      "Disco de vinil 33 RPM, álbum Experience de Gloria Gaynor, pela gravadora MGM Records",
      "Gloria Gaynor",
    ],
    ['Disco de vinil 33 RPM, álbum "Transa" de Caetano Veloso, selo Philips', "Caetano Veloso"],
    [
      "Disco de vinil, 33 RPM, álbum Sammy Davis Jr.'s Greatest Hits, catálogo RLP 77.018",
      "Sammy Davis Jr.",
    ],
    [
      'Disco de vinil 33 RPM, LP Baden Powell "Tempo Feliz", lançado pelo selo Forma',
      "Baden Powell",
    ],
    // "Banda" com maiúscula em título de caixa mista é parte do nome; "da banda Queen" é papel.
    [
      "Disco de vinil em formato LP, álbum Maria Fumaça da Banda Black Rio, 1ª edição de 1977",
      "Banda Black Rio",
    ],
    ["Disco de vinil 33 RPM, da banda Queen, álbum X", "Queen"],
    // Adjetivo/estado/tipo antes do nome.
    [
      "VINIL AUTOGRAFADO, NATAN MARQUES E RICARDO LEÃO , COMBOIO MÍDIA EM ÓTIMO",
      "Natan Marques e Ricardo Leão",
    ],
    [
      "VINIL: AUTOGRAFADO, LP DE LANÇAMENTO DE Wanderley Cardoso O Jovem Romântico. EM BOM",
      "Wanderley Cardoso",
    ],
    ["VINIL DOIS LPs: EARTH WIND & FIRE EM ÓTIMO ESTADO, CAPA COM DESGASTES", "Earth, Wind & Fire"],
    [
      "VINIL: Lp ÓTIMO ESTADO TRACY CHAPMAN , TRACY CHAPMAN , COM ENCARTE CAPA COM",
      "Tracy Chapman",
    ],
    ["VINIL GONZAGUINHA GERAL EM ÓTIMO ESTADO, CAPA COM DESGASTES DE USO E TEMPO", "Gonzaguinha"],
    ["LP IMPORTADO Pink Floyd - The Wall", "Pink Floyd"],
    // Artista citado com papel / aspas simples; nome com erro de digitação; artista+álbum colados.
    [
      'Disco de vinil em formato LP duplo do artista Aqua Bassino, álbum "Rue de Paris". Conjunto',
      "Aqua Bassino",
    ],
    [
      "VINIL JEAN LUC PNTY CIVILIZED EVIL EM ÓTIMO ESTADO, CAPA COM DESGASTES DE USO E TEMPO",
      "Jean-Luc Ponty",
    ],
    [
      "VINIL LP WINTON MARSALIS BLUES ALLEN EM ÓTIMO ESTADO, CAPA COM DESGASTES DE USO",
      "Wynton Marsalis",
    ],
    ["VINIL O MELHOR DE KLEITON & KLEDIR EM ÓTIMO ESTADO, CAPA COM DESGASTES", "Kleiton & Kledir"],
    [
      "LP ÓTIMO ESTADO álbum 'Boom Shack A Lack', de Junior Reid, produzido por Prince Jammy",
      "Junior Reid",
    ],
    // Sem nome conhecido e sem separador: fica sem artista (nunca "artista = título inteiro").
    ["VINIL OTB LIVE AT MT FUJI EM ÓTIMO ESTADO, CAPA COM DESGASTES DE USO E TEMPO", ""],
    // Markdown (**…** / #) usa só o 1º trecho; " / " separa campos; atributos do anúncio saem.
    [
      "**LP BRUCE HORNSBY AND THE RANGE THE WAY IT IS 1987**LANÇADO EM 1987, ESTE É O ÁLBUM DE ESTREIA",
      "Bruce Hornsby and the Range",
    ],
    ["# LP FÁBIO JR. FÁBIO JR. 1994 NACIONAL COM ENCARTEÁLBUM DE FÁBIO JR.", "Fábio Jr"],
    ["LP STEPHEN SCHLAKS / SENSITIVE AND DELICATE / LP , CAPA EM ÓTIMO ESTADO", "Stephen Schlaks"],
    [
      "LP JOE DASSIN JOE DASSIN / 1977 /ÁLBUM CLÁSSICO DO CONSAGRADO CANTOR FRANCO-AMERICANO",
      "Joe Dassin",
    ],
    [
      "**LP DUPLO DORIS DAY PRESENÇA DE DORIS DAY 2 LPS**ÁLBUM DUPLO, REUNINDO INTERPRETAÇÕES DA CANTORA NORTE-AMERICANA EM CLÁSSICOS",
      "Doris Day",
    ],
    [
      "LP NICKEL CREEK / NICKEL CREEK / ALBUM DUPLO 2 LPS / ACLAMADO ÁLBUM DO TRIO AMERICANO DE FOLK",
      "Nickel Creek",
    ],
    [
      "JORGE BEN IMPORTADO JAPÃO |Em excelente estado.| Classificação técnica: capa vg+",
      "Jorge Ben",
    ],
    ["Os Brasas Capa Ruim", "Os Brasas"],
    ["Álbum: Shut Up | Código: 066 | Artista(s): [`Kenny G (2)`] | Ano: 1990", "Kenny G"],
    // Sem "|" antes de "Artista(s)" e sem colchetes: o nome do álbum não vira artista.
    ["Álbum: DE PÉ NO CHÃO | Código: 1030280 Artista(s): BETH CARVALHO", "Beth Carvalho"],
    ["Álbum: PERFOMANCE | Código: 066792845-1 Artista(s): BETO GUEDES", "Beto Guedes"],
    [
      "Álbum: Perfomance | Código: 066 Artista(s): Beto Guedes Ano: 1980 Estilo(s): MPB",
      "Beto Guedes",
    ],
    ["LP E COMPOSITOR BRITÂNICO GEORGE MICHAEL FAITH 1987", ""],
    ["LP CARLOS ALBERTO ANO DE LANÇAMENTO: 1967 FORMATO: LP (VINIL) CONDIÇÃO", "Carlos Alberto"],
    // Nomes que COMEÇAM com o papel não perdem a palavra.
    ["LP Grupo Fundo de Quintal - Samba é no Fundo", "Grupo Fundo de Quintal"],
  ];
  for (const [title, artist] of cases) {
    test(title.slice(0, 60), () => expect(extractArtist(title)).toBe(artist));
  }
  test("formato/estado soltos não são artista (isGenericArtist)", () => {
    for (const a of [
      "12 Polegadas",
      "33 Rpm",
      "Dois LPs",
      "Em Formato LP",
      "Importado",
      "Autografado",
    ]) {
      expect(isGenericArtist(a)).toBe(true);
    }
    expect(isGenericArtist("Banda Black Rio")).toBe(false);
  });
});

describe("extractArtist", () => {
  test('cabeçalho "IMPORTADO <país>! 1 DISCO." não vira o artista', () => {
    expect(
      extractArtist(
        "IMPORTADO FRANÇA! 1 DISCO. HYPERBOREA - TANGERINE DREAM (1983). Selo VIRGIN 70132.",
      ),
    ).toBe("Tangerine Dream");
    expect(
      extractArtist("IMPORTADO FRANÇA! 1 DISCO. PICTURE BOOK - SIMPLY RED. Selo ELEKTRA EKT 27."),
    ).toBe("Simply Red");
    // Artista desconhecido: vem do trecho depois do último " - " (molde "ÁLBUM - ARTISTA. Selo").
    expect(
      extractArtist(
        "IMPORTADO EQUADOR! 1 DISCO. OJOS AZULES - LOS JOKER'S VOL. 6 (1974). Selo ESTELAR",
      ),
    ).toBe("Los Joker's");
    expect(
      extractArtist("IMPORTADO ESTADOS UNIDOS! 1 DISCO. FOO - BAR - THE BAND (1970). Selo X"),
    ).toBe("The Band");
    // Sem " - " nem nome conhecido: sem artista, nunca o cabeçalho.
    expect(
      extractArtist("IMPORTADO COLÔMBIA! 1 DISCO. COMO ES GRANDE MI AMOR POR TI. Selo CBS 14468."),
    ).toBe("");
    expect(
      extractArtist(
        "IMPORTADO COLÔMBIA! 1 DISCO. EL REY: ROBERTO CARLOS EN ESPAÑOL (1973). Selo CBS",
      ),
    ).toBe("Roberto Carlos");
  });
  test('"ÁLBUM DUPLO." não vira o artista "Duplo"', () => {
    // Álbum antes do artista: só o nome conhecido no título resolve.
    expect(
      extractArtist("ÁLBUM DUPLO. ABSOLUTELY LIVE - ROD STEWART (1982). Selo WARNER BROS."),
    ).toBe("Rod Stewart");
    expect(
      extractArtist("ÁLBUM DUPLO. ALL THE BEST! - PAUL McCARTNEY (1987). Selo PARLOPHONE"),
    ).toBe("Paul McCartney");
    expect(
      extractArtist("ÁLBUM DUPLO. GOLD AND PLATINUM - LYNYRD SKYNYRD. Selo MCA 300 740."),
    ).toBe("Lynyrd Skynyrd");
    // Artista antes do álbum, com o formato na frente.
    expect(extractArtist("LP DUPLO - Elis Regina - Falso Brilhante")).toBe("Elis Regina");
    expect(extractArtist("ÁLBUM TRIPLO. Fulano Desconhecido Xyz - Quarteto Qwerty")).toBe("");
    // Sem nenhum nome conhecido: sem artista (nunca o álbum nem "Duplo").
    expect(extractArtist("ÁLBUM DUPLO. 66 POEMAS ESCOLHIDOS RECITADOS PELO AUTOR")).toBe("");
  });
  test('tira "de/do/da" colado ao tipo ("LP de X - Álbum")', () => {
    expect(
      extractArtist("LP de Creedence Clearwater Revival - Green River (1969); Em bom estado."),
    ).toBe("Creedence Clearwater Revival");
    expect(extractArtist("Disco de Vinil de Pink Floyd - The Wall")).toBe("Pink Floyd");
  });
  test("artista antes do separador", () => {
    expect(extractArtist("LP Chico Buarque - Construção")).toBe("Chico Buarque");
    expect(extractArtist("Disco de Vinil Raul Seixas - Krig-ha, Bandolo!")).toBe("Raul Seixas");
    expect(extractArtist("LP Vinil Chico Buarque - Construção 1971 Disco VG+ Capa VG")).toBe(
      "Chico Buarque",
    );
  });
  test("apelido de artista conhecido", () => {
    expect(extractArtist("Compacto Beatles - Help")).toBe("The Beatles");
  });
  test("lote vira a categoria Lote", () => {
    expect(extractArtist("Lote com 10 LPs")).toBe("Lote");
  });
});

test("parsePrice", () => {
  expect(parsePrice("R$ 1.234,56")).toBe(1234.56);
  expect(parsePrice("R$ 50,00")).toBe(50);
  expect(parsePrice("Lance: R$ 10")).toBe(10);
  expect(parsePrice("")).toBeNull();
});

test("normalizeForMatch", () => {
  expect(normalizeForMatch("Construção - Chico Buarque (1971)")).toBe(
    "construcao chico buarque 1971",
  );
});

test("titleCase", () => {
  expect(titleCase("chico BUARQUE de hollanda")).toBe("Chico Buarque de Hollanda");
});

test("pickCanonical prefere a grafia acentuada", () => {
  expect(pickCanonical(["Alceu Valenca", "Alceu Valença"])).toBe("Alceu Valença");
  expect(pickCanonical([])).toBe("");
});

test("decodeHtmlEntities", () => {
  expect(decodeHtmlEntities("A &amp; B &#39;x&#39;")).toBe("A & B 'x'");
});

describe("laterAuctionSlot (leilão de vários dias)", () => {
  test("fica com o dia mais tardio", () => {
    const a = { dayKey: "2026-10-02", time: "19h" };
    const b = { dayKey: "2026-10-03", time: "10h" };
    expect(laterAuctionSlot(a, b)).toBe(b);
    expect(laterAuctionSlot(b, a)).toBe(b);
  });
  test("mesmo dia: hora maior vence (9h < 19h)", () => {
    const a = { dayKey: "2026-10-02", time: "9h" };
    const b = { dayKey: "2026-10-02", time: "19h" };
    expect(laterAuctionSlot(a, b)).toBe(b);
  });
  test("null perde; hora ilegível perde", () => {
    const a = { dayKey: "2026-10-02", time: "19h" };
    expect(laterAuctionSlot(null, a)).toBe(a);
    expect(laterAuctionSlot(a, null)).toBe(a);
    expect(laterAuctionSlot(a, { dayKey: "2026-10-05", time: "" })).toBe(a);
  });
});

describe("lotOpenUrl", () => {
  test("troca o redirecionador abre_catalogo pela peca.asp da casa", () => {
    expect(
      lotOpenUrl(
        "https://leiloesbr.com.br/abre_catalogo.asp?t=1|http://www.casa.com.br|65073|32383278",
      ),
    ).toBe("https://www.casa.com.br/peca.asp?ID=32383278&ctd=1&tot=&tipo=&artista=");
  });
  test("Trem das 7 abre o catálogo filtrado pelo título", () => {
    expect(
      lotOpenUrl(
        "https://leiloesbr.com.br/abre_catalogo.asp?t=1|http://www.tremdas7.com.br|65073|32383278",
        "**LP BAILE GAÚCHO VOL. 2**, LANÇADO EM **1975**",
      ),
    ).toBe("https://www.tremdas7.com.br/catalogo.asp?Num=65073&p=on&pesquisa=GA%C3%9ACHO");
  });
  test("Trem das 7 pesquisa a palavra mais longa do título", () => {
    expect(
      lotOpenUrl(
        "https://leiloesbr.com.br/abre_catalogo.asp?t=1|http://www.tremdas7.com.br|65073|1",
        "LP CLARIDADE CLARA NUNES 1975. ÁLBUM DE SAMBA",
      ),
    ).toBe("https://www.tremdas7.com.br/catalogo.asp?Num=65073&p=on&pesquisa=CLARIDADE");
  });
  test("Trem das 7 com nº do lote vai direto ao lote", () => {
    expect(
      lotOpenUrl(
        "https://leiloesbr.com.br/abre_catalogo.asp?t=1|http://www.tremdas7.com.br|65073|1",
        "LP CLARIDADE CLARA NUNES 1975",
        "655A",
      ),
    ).toBe("https://www.tremdas7.com.br/catalogo.asp?Num=65073&p=on&irpara=655A");
  });
  test("deixa links fora do padrão intactos", () => {
    expect(lotOpenUrl("https://casa.com.br/peca.asp?ID=1")).toBe(
      "https://casa.com.br/peca.asp?ID=1",
    );
  });
});

describe("trackedAuctionStatus", () => {
  const none = { inProgress: false, finished: false, seenLive: false };
  test("pregão longo com peças pela frente fica ao vivo (sem janela de horas)", () => {
    expect(
      trackedAuctionStatus("ended", "2026-10-07", { ...none, inProgress: true }, "2026-10-07"),
    ).toBe("live");
  });
  test("peça = total encerra", () => {
    expect(
      trackedAuctionStatus("live", "2026-10-07", { ...none, finished: true }, "2026-10-07"),
    ).toBe("ended");
  });
  test("presencial parou de responder depois de visto ao vivo → encerrado; sem sinal → ao vivo", () => {
    expect(
      trackedAuctionStatus("live", "2026-10-07", { ...none, seenLive: true }, "2026-10-07"),
    ).toBe("ended");
    expect(trackedAuctionStatus("ended", "2026-10-07", none, "2026-10-07")).toBe("live");
  });
  test("dia anterior encerra; em breve/sem horário passam intactos", () => {
    expect(
      trackedAuctionStatus("ended", "2026-10-06", { ...none, inProgress: true }, "2026-10-07"),
    ).toBe("ended");
    expect(trackedAuctionStatus("upcoming", "2026-10-07", none, "2026-10-07")).toBe("upcoming");
    expect(trackedAuctionStatus(null, "2026-10-07", none, "2026-10-07")).toBeNull();
  });
});

describe("collectionNeedsIdentification", () => {
  test("sem artista ou sem álbum precisa; baldes Lote/Coletâneas não", () => {
    expect(collectionNeedsIdentification({ artist: "", album: "X" })).toBe(true);
    expect(collectionNeedsIdentification({ artist: UNCLASSIFIED_LABEL, album: "X" })).toBe(true);
    expect(collectionNeedsIdentification({ artist: "Alceu Valença", album: "" })).toBe(true);
    expect(collectionNeedsIdentification({ artist: "Alceu Valença", album: "Molhado" })).toBe(
      false,
    );
    expect(collectionNeedsIdentification({ artist: "Lote", album: "" })).toBe(false);
    expect(collectionNeedsIdentification({ artist: "Coletâneas", album: "" })).toBe(false);
  });
});

describe("splitRecordSpec", () => {
  test("separa nome e ficha", () => {
    expect(
      splitRecordSpec(
        "Traffic - On The Road | Fabricação: Espanha | Ano: 1980 | Capa: MB / Mídia: MB",
      ),
    ).toEqual({
      name: "Traffic - On The Road",
      spec: "Fabricação: Espanha | Ano: 1980 | Capa: MB / Mídia: MB",
    });
  });
  test("sem ficha devolve o título", () => {
    expect(splitRecordSpec("LP Cher - Heart of Stone")).toEqual({
      name: "LP Cher - Heart of Stone",
      spec: "",
    });
  });
});

describe("isLotePassed", () => {
  test("só lote numérico anterior ao atual", () => {
    expect(isLotePassed("12", "40")).toBe(true);
    expect(isLotePassed("40", "40")).toBe(false);
    expect(isLotePassed("41", "40")).toBe(false);
  });
  test("sem nº ou ilegível não conta", () => {
    expect(isLotePassed(null, "40")).toBe(false);
    expect(isLotePassed("", "40")).toBe(false);
    expect(isLotePassed("12", "--")).toBe(false);
  });
});
