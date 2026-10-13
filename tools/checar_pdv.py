#!/usr/bin/env python3
"""Checagem de sanidade: cada ponto está dentro da caixa aproximada do seu estado?"""
import json, sys
from pathlib import Path
# caixas (lat_min, lat_max, lon_min, lon_max) aproximadas por UF
BOX = {"CE":(-7.9,-2.7,-41.5,-37.2),"SP":(-25.4,-19.7,-53.2,-44.1),"PI":(-11.0,-2.7,-45.9,-40.3),"BA":(-18.4,-8.5,-46.7,-37.3),
       "PE":(-9.5,-7.3,-41.4,-34.7),"RN":(-6.99,-4.8,-38.6,-34.9),"DF":(-16.1,-15.4,-48.3,-47.3),"PR":(-26.8,-22.5,-54.7,-48.0),
       "MA":(-10.3,-1.0,-48.8,-41.7),"AL":(-10.6,-8.8,-38.3,-35.1),"PB":(-8.4,-6.0,-38.8,-34.7),"AP":(-1.3,4.5,-54.9,-49.8),"SE":(-11.6,-9.5,-38.3,-36.3)}
d = json.loads(Path(sys.argv[1] if len(sys.argv) > 1 else "data/pontos-de-venda.json").read_text())
ruins = []
for p in d["pontos"]:
    b = BOX.get(p["uf"])
    if b and not (b[0] <= p["lat"] <= b[1] and b[2] <= p["lon"] <= b[3]):
        ruins.append(p)
print(f"{len(d['pontos'])} pontos; fora da caixa do estado: {len(ruins)}")
for p in ruins:
    print(" -", p["id"], p["nome"], p["cidade"], p["uf"], p["lat"], p["lon"], p["prec"])
