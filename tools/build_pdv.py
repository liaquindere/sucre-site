#!/usr/bin/env python3
"""
Gera data/pontos-de-venda.json a partir da planilha de clientes B2B.

Uso:
  python3 tools/build_pdv.py "caminho/da/BASE DE CLIENTES B2B.xlsx"

O que faz:
  1. Lê a planilha (colunas: Grupo, Nome Fantasia, Rede de Supermercado,
     Tipo endereço, Rua, Nº, CEP, Bairro, Cidade, Estado).
  2. Mantém só os tipos de estabelecimento abertos ao consumidor
     (lista GRUPOS_PUBLICOS). Distribuidores, clientes corporativos,
     cantinas de escola etc. ficam de fora do mapa.
  3. Limpa nome/endereço para exibição (sem dados comerciais internos).
  4. Geocodifica cada endereço (Nominatim/OpenStreetMap, 1 req/s) com
     cache em tools/geocache.json: só endereços novos consultam a internet.
  5. Inclui os pontos manuais de data/pontos-extras.json (ex.: lojas Sucré).
  6. Escreve data/pontos-de-venda.json e um relatório no terminal.

Precisão registrada em cada ponto ("prec"):
  endereco  -> rua + número encontrados (ou o próprio estabelecimento no mapa)
  rua       -> só a rua (número não encontrado)
  bairro    -> centro do bairro
  cidade    -> centro da cidade
"""
import json, re, sys, time, unicodedata, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_FILE = ROOT / "tools" / "geocache.json"
OUT_FILE = ROOT / "data" / "pontos-de-venda.json"
EXTRAS_FILE = ROOT / "data" / "pontos-extras.json"
UA = "SucreSiteStoreLocator/1.0 (atendimento@sucre.com.br)"
NOMINATIM = "https://nominatim.openstreetmap.org/search"

# Grupos da planilha que aparecem no mapa -> rótulo público
GRUPOS_PUBLICOS = {
    "SUPERMERCADO": "Supermercado",
    "LOJA DE CONVENIÊNCIA": "Loja de conveniência",
    "LOJA DE CONVENIENCIA": "Loja de conveniência",
    "CAFETERIA": "Cafeteria",
    "RESTAURANTE": "Restaurante e bar",
    "BAR E RESTAURANTE": "Restaurante e bar",
    "PIZZARIA": "Restaurante e bar",
    "EMPORIO": "Empório",
    "EMPÓRIO": "Empório",
    "LOJA SUCRÉ": "Loja Sucré",
}

UF_NOME = {
    "AC": "Acre", "AL": "Alagoas", "AP": "Amapá", "AM": "Amazonas", "BA": "Bahia",
    "CE": "Ceará", "DF": "Distrito Federal", "ES": "Espírito Santo", "GO": "Goiás",
    "MA": "Maranhão", "MT": "Mato Grosso", "MS": "Mato Grosso do Sul", "MG": "Minas Gerais",
    "PA": "Pará", "PB": "Paraíba", "PR": "Paraná", "PE": "Pernambuco", "PI": "Piauí",
    "RJ": "Rio de Janeiro", "RN": "Rio Grande do Norte", "RS": "Rio Grande do Sul",
    "RO": "Rondônia", "RR": "Roraima", "SC": "Santa Catarina", "SP": "São Paulo",
    "SE": "Sergipe", "TO": "Tocantins",
}

TIPO_LOGRADOURO = {
    "AV": "Avenida", "AVENIDA": "Avenida", "R": "Rua", "RUA": "Rua", "ROD": "Rodovia",
    "RODOVIA": "Rodovia", "Q": "Quadra", "QUADRA": "Quadra", "ST": "Setor", "AREA": "Área",
    "ALAMEDA": "Alameda", "TRAVESSA": "Travessa", "CONJUNTO": "Conjunto", "JARDIM": "Jardim",
    "SETOR DE HABITAÇÕES": "Setor de Habitações", "PRAÇA": "Praça", "PRACA": "Praça",
    "CONDOMINIO": "Condomínio", "CONDOMÍNIO": "Condomínio", "ESTRADA": "Estrada",
}

MINUSCULAS = {"de", "da", "do", "das", "dos", "e", "com", "em", "a", "o", "no", "na"}
SIGLAS = {"SP", "CE", "DF", "BR", "PE", "RN", "PI", "BA", "MA", "AL", "PB", "AP", "SE", "PR",
          "QNL", "QD", "AE", "STN", "QE", "BL", "CLSW", "SEPN", "EQS", "SHIS", "QI", "QR", "MU",
          "CLN", "SHA", "CJ", "CHC", "LTS", "SHC", "CL", "SHCN", "KM", "SGCV", "LT", "LJS", "LJ",
          "II", "III", "IV", "BDV", "FS", "PNB", "ZBOYS"}


def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", str(s)) if unicodedata.category(c) != "Mn")


def norm(s):
    return re.sub(r"\s+", " ", sem_acento(s or "").upper().strip())


def titulo(texto):
    """Title case que respeita conectivos e siglas (ADORATTO SUPERMERCADO -> Adoratto Supermercado)."""
    if not texto:
        return ""
    palavras = []
    for i, w in enumerate(str(texto).split()):
        base = w.strip("(),.")
        if w.lower() in MINUSCULAS and i > 0:
            palavras.append(w.lower())
        elif base.upper() in SIGLAS or (len(base) <= 2 and base.isalpha() and base.isupper() and i > 0):
            palavras.append(w.upper())
        else:
            palavras.append(w[:1].upper() + w[1:].lower())
    return " ".join(palavras)


def limpa_nome(nome):
    n = str(nome or "").strip()
    n = re.sub(r"\s*\((LJ|LOJA)\.?\s*\d+\)", "", n, flags=re.I)          # "(LJ 27)" em qualquer lugar
    n = re.sub(r"\s*\b(LJ|LOJA)\.?\s*\d+\s*$", "", n, flags=re.I)          # "LJ 14" no fim do nome
    n = re.sub(r"\b(LJ|LOJA)\b\.?", "", n, flags=re.I)                     # "LJ 506 ASA NORTE" -> "506 ASA NORTE"; "LJ GUARA II" -> "GUARA II"
    n = re.sub(r"\b(LTDA|S/?A|EIRELI|ME|EPP)\b\.?", "", n, flags=re.I)
    n = re.sub(r"\s+", " ", n).strip(" -–")
    return titulo(n)


def limpa_rede(rede, uf):
    r = str(rede or "").strip()
    r = re.sub(r"\s*-\s*[A-Z]{2}$", "", r)                 # "GRUPO MATEUS - CE"
    r = re.sub(rf"\s+{uf}$", "", r)                        # "ASSAÍ CE"
    r = re.sub(r"\s+SUP\.$", "", r)
    return titulo(r)


def fmt_cep(cep):
    d = re.sub(r"\D", "", str(cep or ""))
    if len(d) == 7:
        d = "0" + d
    return f"{d[:5]}-{d[5:]}" if len(d) == 8 else ""


def fmt_numero(n):
    s = str(n or "").strip()
    if s.upper() in {"", "S/N", "SN", "NONE"}:
        return ""
    return s.split(".")[0] if re.fullmatch(r"\d+\.0", s) else s


# ---------------------------------------------------------------- geocoder
class Geocoder:
    def __init__(self):
        self.cache = json.loads(CACHE_FILE.read_text()) if CACHE_FILE.exists() else {}
        self.ultimo = 0.0
        self.consultas = 0

    def salvar(self):
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(json.dumps(self.cache, ensure_ascii=False, indent=0))

    def _get(self, params):
        chave = urllib.parse.urlencode(sorted(params.items()))
        if chave in self.cache:
            return self.cache[chave]
        espera = 1.1 - (time.time() - self.ultimo)
        if espera > 0:
            time.sleep(espera)
        url = NOMINATIM + "?" + urllib.parse.urlencode({**params, "format": "json", "addressdetails": 1, "limit": 3, "countrycodes": "br"})
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "pt-BR"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                dados = json.loads(resp.read().decode())
        except Exception as e:  # noqa
            print("   ! erro nominatim:", e, file=sys.stderr)
            time.sleep(3)
            dados = []
        self.ultimo = time.time()
        self.consultas += 1
        self.cache[chave] = dados
        if self.consultas % 20 == 0:
            self.salvar()
        return dados

    @staticmethod
    def _cidade_ok(res, cidade, uf):
        a = res.get("address", {})
        estado_ok = norm(a.get("state", "")) == norm(UF_NOME.get(uf, uf)) or norm(a.get("ISO3166-2-lvl4", "")).endswith(uf)
        if uf == "DF":  # Brasília é o único município do DF; as RAs (Taguatinga, Guará...) aparecem como cidade no OSM
            return estado_ok
        campos = [a.get(k, "") for k in ("city", "town", "municipality", "village", "city_district", "county")]
        cidade_ok = any(norm(c) == norm(cidade) for c in campos) or norm(cidade) in norm(res.get("display_name", ""))
        return estado_ok and cidade_ok

    AMPLOS = {"city", "town", "municipality", "state", "county", "region", "state_district"}

    def _escolhe(self, resultados, cidade, uf, exige_cidade=True, bairro=None):
        for r in resultados:
            if exige_cidade and not self._cidade_ok(r, cidade, uf):
                continue
            if exige_cidade and r.get("addresstype") in self.AMPLOS:
                continue  # a busca por rua/bairro devolveu a cidade inteira: não serve
            if bairro:
                a = r.get("address", {})
                sub = norm(" ".join(a.get(k, "") for k in ("suburb", "neighbourhood", "quarter", "city_district", "residential")))
                if norm(bairro) and norm(bairro) not in sub and sub not in norm(bairro):
                    continue
            return float(r["lat"]), float(r["lon"])
        return None

    def geocodificar(self, p):
        """p = dict com tipo_log, rua, numero, bairro, cidade, uf, cep, nome, rede. Retorna (lat, lon, prec)."""
        cidade, uf = p["cidade"], p["uf"]
        rua = f"{p['tipo_log']} {p['rua']}".strip()
        estado = UF_NOME.get(uf, uf)

        central = p.get("central")  # endereço de entrega compartilhado (matriz): não serve pra localizar a loja
        # A) estruturado com número + CEP
        if p["numero"] and not central:
            r = self._escolhe(self._get({"street": f"{p['numero']} {rua}", "city": cidade, "state": estado, "postalcode": p["cep"]}), cidade, uf)
            if r: return (*r, "endereco")
            r = self._escolhe(self._get({"q": f"{rua}, {p['numero']}, {cidade}, {uf}"}), cidade, uf)
            if r: return (*r, "endereco")
        # B) o próprio estabelecimento como POI (rede + bairro + cidade)
        for nome in dict.fromkeys([p["rede"], p["nome"]]):
            if not nome:
                continue
            res = self._get({"q": f"{nome}, {p['bairro']}, {cidade}", "featureType": ""})
            res = [x for x in res if x.get("class") in ("shop", "amenity", "building", "leisure")]
            r = self._escolhe(res, cidade, uf, bairro=p["bairro"])
            if r: return (*r, "endereco")
        # C) só a rua
        if p["rua"] and not central and p["tipo_log"] in ("Avenida", "Rua", "Rodovia", "Alameda", "Travessa", "Praça", "Estrada"):
            r = self._escolhe(self._get({"q": f"{rua}, {p['bairro']}, {cidade}, {uf}"}), cidade, uf)
            if r: return (*r, "rua")
            r = self._escolhe(self._get({"q": f"{rua}, {cidade}, {uf}"}), cidade, uf)
            if r: return (*r, "rua")
        # C2) Brasília: endereço por quadra (CLN 213, SEPN 506, QNL 1...), que o OSM conhece bem
        if uf == "DF" and not central:
            m = re.search(r"\b([A-Z]{2,5}(?:/[A-Z]+)?(?:\s+CL)?(?:\s+QUADRA|\s+QD)?\s*\d+[A-Z]?(?:/\d+)?)\b", (p["rua"] or "").upper())
            if m:
                quadra = re.sub(r"\b(QUADRA|QD)\b", "", m.group(1)).replace("  ", " ").strip()
                r = self._escolhe(self._get({"q": f"{quadra}, Brasília, DF"}), cidade, uf)
                if r: return (*r, "rua")
        # D) bairro (com variantes: "Setor Industrial (Taguatinga)" -> Taguatinga; "Guara II" -> Guara)
        if p["bairro"]:
            b0 = p["bairro"]
            variantes = [re.sub(r"\(.*?\)", "", b0).strip()]
            m = re.search(r"\((.*?)\)", b0)
            if m: variantes.append(m.group(1).strip())
            variantes.append(re.sub(r"^(SETOR HABITACIONAL|SETOR DE HABITACOES|ZONA INDUSTRIAL|SETOR INDUSTRIAL|SETOR)\s+", "", sem_acento(variantes[0]).upper(), flags=re.I).title())
            variantes.append(re.sub(r"\s+(I|II|III|IV|\d+)$", "", variantes[0]).strip())
            for bairro in dict.fromkeys(v for v in variantes if v and norm(v) != norm(cidade)):
                r = self._escolhe(self._get({"q": f"{bairro}, {cidade}, {uf}"}), cidade, uf)
                if r: return (*r, "bairro")
        # E) cidade
        r = self._escolhe(self._get({"city": cidade, "state": estado}), cidade, uf, exige_cidade=False)
        if r: return (*r, "cidade")
        return None


# ---------------------------------------------------------------- main
def ler_planilha(caminho):
    import openpyxl
    wb = openpyxl.load_workbook(caminho, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    linhas = [r for r in ws.iter_rows(values_only=True) if any(r)]
    cab = [norm(c) for c in linhas[0]]

    def col(nome):
        for i, c in enumerate(cab):
            if c.startswith(norm(nome)):
                return i
        raise SystemExit(f"Coluna não encontrada na planilha: {nome}")

    def col_contem(trecho):
        for i, c in enumerate(cab):
            if norm(trecho) in c:
                return i
        raise SystemExit(f"Coluna não encontrada na planilha: {trecho}")

    ix = {k: col(k) for k in ["Grupo", "Nome Fantasia", "Rede", "Tipo", "CEP", "Bairro", "Cidade", "Estado"]}
    ix["Rua"] = col_contem("Rua do")          # "Rua do destinatário"
    ix["N"] = col_contem("da rua")            # "Nº da rua de entrega"
    pontos = []
    for r in linhas[1:]:
        g = lambda k: (r[ix[k]] if r[ix[k]] is not None else "")
        grupo = norm(g("Grupo"))
        if grupo not in {norm(k) for k in GRUPOS_PUBLICOS}:
            continue
        tipo_pub = next(v for k, v in GRUPOS_PUBLICOS.items() if norm(k) == grupo)
        uf = str(g("Estado")).strip().upper()
        tipo_log = TIPO_LOGRADOURO.get(norm(g("Tipo")), titulo(str(g("Tipo"))))
        rua = str(g("Rua")).strip()
        rua = re.sub(r"^(AV|AVENIDA|R|RUA|ROD|RODOVIA)\.?\s+", "", rua, flags=re.I)  # "AV VICTOR..." já tem o tipo na outra coluna
        pontos.append({
            "nome": limpa_nome(g("Nome Fantasia")),
            "rede": limpa_rede(g("Rede"), uf),
            "tipo": tipo_pub,
            "tipo_log": tipo_log,
            "rua": titulo(rua),
            "numero": fmt_numero(g("N")),
            "cep": fmt_cep(g("CEP")),
            "bairro": titulo(str(g("Bairro")).strip()),
            "cidade": titulo(str(g("Cidade")).strip()),
            "uf": uf,
        })
    return pontos


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    pontos = ler_planilha(sys.argv[1])
    extras = json.loads(EXTRAS_FILE.read_text()) if EXTRAS_FILE.exists() else []
    geo = Geocoder()
    saida, falhas = [], []
    vistos = set()
    from collections import Counter
    uso = Counter((norm(p["rede"]), norm(p["rua"]), p["numero"]) for p in pontos)
    for p in pontos:
        p["central"] = uso[(norm(p["rede"]), norm(p["rua"]), p["numero"])] >= 4
    print(f"{sum(p['central'] for p in pontos)} pontos com endereço central de entrega (serão localizados pelo bairro).")
    print(f"{len(pontos)} pontos públicos na planilha + {len(extras)} extras. Geocodificando...")
    for i, p in enumerate(pontos, 1):
        chave = (norm(p["nome"]), norm(p["cidade"]), norm(p["rua"])[:15], p["numero"])
        if chave in vistos:
            continue
        vistos.add(chave)
        res = geo.geocodificar(p)
        if not res:
            falhas.append(p)
            print(f"[{i}/{len(pontos)}] SEM COORDENADA: {p['nome']} ({p['cidade']}/{p['uf']})")
            continue
        lat, lon, prec = res
        endereco = f"{p['tipo_log']} {p['rua']}".strip()
        if p["numero"]:
            endereco += f", {p['numero']}"
        if p["central"]:
            endereco = ""  # o endereço da planilha é o da matriz; no site mostramos só bairro e cidade
        saida.append({
            "id": f"p{len(saida)+1}",
            "nome": p["nome"],
            "rede": p["rede"] or p["nome"],  # sempre preenchida: quando não há rede, a própria loja é a rede
            "tipo": p["tipo"],
            "endereco": endereco,
            "bairro": p["bairro"],
            "cidade": p["cidade"],
            "uf": p["uf"],
            "cep": "" if p["central"] else p["cep"],
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "prec": prec,
        })
        if i % 25 == 0:
            print(f"[{i}/{len(pontos)}] ok ({geo.consultas} consultas online)")
    geo.salvar()

    for e in extras:  # pontos manuais já vêm com lat/lon
        e.setdefault("prec", "endereco")
        e.setdefault("id", f"x{len(saida)+1}")
        saida.append(e)

    saida.sort(key=lambda x: (x["uf"], x["cidade"], x["nome"]))
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps({
        "atualizado": time.strftime("%Y-%m-%d"),
        "fonte": "Base de clientes B2B (planilha) + pontos-extras.json",
        "pontos": saida,
    }, ensure_ascii=False, separators=(",", ":")))

    from collections import Counter
    prec = Counter(x["prec"] for x in saida)
    print("\n=== RESULTADO ===")
    print(f"Gravado: {OUT_FILE} ({len(saida)} pontos)")
    print("Precisão:", dict(prec))
    print("Por estado:", dict(sorted(Counter(x['uf'] for x in saida).items())))
    print("Por tipo:", dict(Counter(x['tipo'] for x in saida)))
    if falhas:
        print(f"\n{len(falhas)} sem coordenada (ficaram fora do mapa):")
        for f in falhas:
            print("  -", f["nome"], "|", f["tipo_log"], f["rua"], f["numero"], "|", f["bairro"], f["cidade"], f["uf"])


if __name__ == "__main__":
    main()
