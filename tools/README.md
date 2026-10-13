# Como atualizar os pontos de venda do site

A página **onde-encontrar.html** lê o arquivo `data/pontos-de-venda.json`.
Esse arquivo é gerado a partir da planilha de clientes pelo script `tools/build_pdv.py`.

## Passo a passo

1. Exporte a planilha de clientes (mesmas colunas de hoje: Grupo, Nome Fantasia,
   Rede de Supermercado, Tipo endereço de entrega, Rua do destinatário, Nº da rua
   de entrega, CEP, Bairro, Cidade, Estado).
2. No Terminal, dentro da pasta do site:

   ```bash
   python3 tools/build_pdv.py "/caminho/da/BASE DE CLIENTES B2B.xlsx"
   ```

   O script só consulta a internet para endereços novos (os já conhecidos ficam
   guardados em `tools/geocache.json`), por isso uma atualização costuma levar
   poucos minutos.
3. Confira o resumo que aparece no terminal (quantos pontos, precisão, falhas).
4. Publique: `git add -A && git commit -m "Atualiza pontos de venda" && git push`.

## O que entra no mapa

Só os tipos abertos ao consumidor (lista `GRUPOS_PUBLICOS` no script):
supermercado, loja de conveniência, cafeteria, restaurante/bar/pizzaria e empório.
Distribuidores, clientes corporativos, cantinas de escola, motel e dark stores de
delivery ficam de fora. Para mudar isso, edite a lista no script.

Lojas com endereço de entrega centralizado (ex.: todas as lojas da Frosty usam o
endereço da matriz) aparecem no mapa pelo bairro, sem exibir a rua da matriz.

## Lojas próprias da Sucré ou pontos fora da planilha

Adicione em `data/pontos-extras.json` (lista JSON). Exemplo:

```json
[
  {
    "nome": "Loja Sucré Aldeota",
    "tipo": "Loja Sucré",
    "endereco": "Rua Exemplo, 123",
    "bairro": "Aldeota",
    "cidade": "Fortaleza",
    "uf": "CE",
    "cep": "60000-000",
    "lat": -3.7319,
    "lon": -38.5267
  }
]
```

Latitude e longitude: abra o local no Google Maps, clique com o botão direito no
ponto e copie as coordenadas. Depois rode o script de novo (passo 2).

## Precisão dos pontos

Cada ponto guarda um campo `prec`: `endereco` (exato), `rua`, `bairro` ou `cidade`
(aproximados). Os aproximados mostram o aviso "local aproximado no mapa" e o botão
"Como chegar" manda o nome da loja + cidade para o Google Maps resolver.
Para corrigir um ponto na mão, basta colocá-lo em `data/pontos-extras.json` com as
coordenadas certas e, se quiser, tirar da planilha.
