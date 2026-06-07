"""
processar_logs.py — Pré-processamento dos arquivos .LOG para o site Orquestra Molecular Mobile.

Lê os 20 arquivos Gaussian (.LOG) da pasta 'moleculas_db/moleculas simples',
extrai geometria (atoms, coords), frequências (freqs) e modos vibracionais (modes),
e salva tudo num único arquivo JSON estático: db_moleculas.json.

Uso:
    python processar_logs.py
"""

import os
import re
import json
import sys

# Pasta de entrada com os arquivos .LOG
PASTA_LOGS = os.path.join("moleculas_db", "moleculas simples")
# Arquivo de saída
ARQUIVO_SAIDA = "db_moleculas.json"

# Tabela de conversão número atômico -> símbolo
TABELA_ATOMOS = {
    1: 'H', 2: 'He', 3: 'Li', 4: 'Be', 5: 'B', 6: 'C', 7: 'N', 8: 'O',
    9: 'F', 10: 'Ne', 11: 'Na', 12: 'Mg', 13: 'Al', 14: 'Si', 15: 'P',
    16: 'S', 17: 'Cl', 18: 'Ar', 19: 'K', 20: 'Ca', 26: 'Fe', 29: 'Cu',
    30: 'Zn', 35: 'Br', 53: 'I',
    # Lantanídeos
    57: 'La', 58: 'Ce', 59: 'Pr', 60: 'Nd', 61: 'Pm', 62: 'Sm',
    63: 'Eu', 64: 'Gd', 65: 'Tb', 66: 'Dy', 67: 'Ho', 68: 'Er',
    69: 'Tm', 70: 'Yb', 71: 'Lu',
}


def extrair_nome_molecula(nome_arquivo: str) -> str:
    """Extrai nome limpo da molécula a partir do nome do arquivo.
    Ex: 'CH4FREQ.LOG' -> 'CH4'
    """
    nome = os.path.splitext(nome_arquivo)[0]  # Remove extensão
    # Remove sufixo FREQ (case insensitive)
    nome = re.sub(r'FREQ$', '', nome, flags=re.IGNORECASE)
    return nome


def parse_gaussian_log(caminho: str) -> dict:
    """Extrai dados de um arquivo Gaussian .LOG.

    Retorna dict com:
        atoms: lista de símbolos atômicos
        coords: lista de [x, y, z]
        freqs: lista de frequências (cm⁻¹)
        modes: lista de modos, cada um lista de [dx, dy, dz] por átomo
        syms: lista de labels de simetria
    """
    with open(caminho, 'r', encoding='utf-8', errors='replace') as f:
        texto = f.read()

    linhas = texto.split('\n')

    # =============================================
    # 1. Extrair geometria (última "Standard orientation" ou "Input orientation")
    # =============================================
    atoms = []
    coords = []

    for i, linha in enumerate(linhas):
        if re.search(r'(Standard|Input|Z-Matrix)\s+orientation:', linha, re.IGNORECASE):
            # Reinicia para capturar a última ocorrência
            atoms = []
            coords = []
            capturando = False
            dashes_count = 0
            for j in range(i + 1, len(linhas)):
                if '------' in linhas[j]:
                    dashes_count += 1
                    if dashes_count == 3:
                        break
                    continue
                if dashes_count == 2:
                    partes = linhas[j].strip().split()
                    if len(partes) >= 6:
                        num_atomico = int(partes[1])
                        simbolo = TABELA_ATOMOS.get(num_atomico, 'X')
                        x = float(partes[-3])
                        y = float(partes[-2])
                        z = float(partes[-1])
                        atoms.append(simbolo)
                        coords.append([round(x, 6), round(y, 6), round(z, 6)])

    if not atoms:
        raise ValueError(f"Geometria não encontrada em {caminho}")

    # =============================================
    # 2. Extrair frequências, simetrias e modos
    # =============================================
    freqs = []
    modes = []
    syms = []
    n_atoms = len(atoms)

    # Dividir pelas ocorrências de "Frequencies --"
    blocos_freq = texto.split('Frequencies --')

    for idx in range(1, len(blocos_freq)):
        bloco_linhas = blocos_freq[idx].split('\n')

        # Frequências
        valores_freq = bloco_linhas[0].strip().split()
        qtd_modos = len(valores_freq)
        freqs.extend(float(v) for v in valores_freq)

        # Simetrias (linha antes de "Frequencies --")
        bloco_anterior = blocos_freq[idx - 1].split('\n')
        linha_sym = bloco_anterior[-2] if len(bloco_anterior) >= 2 else ""
        sym_labels = linha_sym.strip().split()
        sym_labels_validos = [s for s in sym_labels if re.match(r"^[A-Za-z][A-Za-z0-9'\"]*$", s)]
        if len(sym_labels_validos) == qtd_modos:
            syms.extend(sym_labels_validos)
        else:
            syms.extend(["N/A"] * qtd_modos)

        # Modos vibracionais (deslocamentos XYZ por átomo)
        # Procura a linha "Atom  AN      X      Y      Z ..."
        start_modos = None
        for k, bl in enumerate(bloco_linhas):
            if re.match(r'\s*Atom\s+AN\s+X\s+Y\s+Z', bl, re.IGNORECASE):
                start_modos = k + 1
                break

        modos_bloco = [[] for _ in range(qtd_modos)]

        if start_modos is not None:
            for j in range(n_atoms):
                linha_idx = start_modos + j
                if linha_idx >= len(bloco_linhas) or bloco_linhas[linha_idx].strip() == '':
                    break
                partes = bloco_linhas[linha_idx].strip().split()
                # Formato: idx  AN  X1 Y1 Z1  X2 Y2 Z2  X3 Y3 Z3
                # Pular os 2 primeiros campos (Atom, AN)
                valores = partes[2:]
                for m in range(qtd_modos):
                    try:
                        dx = float(valores[m * 3])
                        dy = float(valores[m * 3 + 1])
                        dz = float(valores[m * 3 + 2])
                        modos_bloco[m].append([dx, dy, dz])
                    except (IndexError, ValueError):
                        pass

        modes.extend(modos_bloco)

    return {
        "atoms": atoms,
        "coords": coords,
        "freqs": freqs,
        "modes": modes,
        "syms": syms,
    }


def main():
    if not os.path.isdir(PASTA_LOGS):
        print(f"❌ Pasta não encontrada: {PASTA_LOGS}")
        sys.exit(1)

    # Listar todos os .LOG
    arquivos_log = sorted([
        f for f in os.listdir(PASTA_LOGS)
        if f.upper().endswith('.LOG')
    ])

    if not arquivos_log:
        print(f"❌ Nenhum arquivo .LOG encontrado em {PASTA_LOGS}")
        sys.exit(1)

    print(f"🔬 Encontrados {len(arquivos_log)} arquivos .LOG")
    print("=" * 50)

    moleculas = []
    erros = []

    for nome_arquivo in arquivos_log:
        caminho = os.path.join(PASTA_LOGS, nome_arquivo)
        nome_mol = extrair_nome_molecula(nome_arquivo)

        try:
            dados = parse_gaussian_log(caminho)
            moleculas.append({
                "id": f"mol_{nome_mol}",
                "nome": nome_mol,
                "data": dados,
            })
            print(f"  ✅ {nome_mol:12s} | {len(dados['atoms']):3d} átomos | {len(dados['freqs']):3d} modos")
        except Exception as e:
            erros.append((nome_arquivo, str(e)))
            print(f"  ❌ {nome_arquivo}: {e}")

    print("=" * 50)
    print(f"✅ {len(moleculas)} moléculas processadas com sucesso")
    if erros:
        print(f"❌ {len(erros)} erros:")
        for nome, erro in erros:
            print(f"   - {nome}: {erro}")

    # Salvar JSON
    with open(ARQUIVO_SAIDA, 'w', encoding='utf-8') as f:
        json.dump(moleculas, f, ensure_ascii=False)

    tamanho = os.path.getsize(ARQUIVO_SAIDA)
    print(f"\n📦 Salvo em: {ARQUIVO_SAIDA} ({tamanho / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
