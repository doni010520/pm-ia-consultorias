#!/usr/bin/env python3
"""
Update the n8n workflow 'agente' (Rica) with 14 new CRM tool nodes
and updated system prompt.
"""
import sys
import json
import uuid
import os
import requests

sys.stdout.reconfigure(encoding='utf-8')

# ── Config ──────────────────────────────────────────────────────────────────
API_BASE = "https://criadordigital-n8n-editor.zsvt2k.easypanel.host/api/v1"
WORKFLOW_ID = "56f4gE0UKHEXMUfa"
API_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJzdWIiOiI4ZTRmZTg2NS02ZDRlLTQ2ZGYtYTBlYi1lZTM1ZWEzOTk4MzUiLCJpc3Mi"
    "OiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzc1NjU5NDY2LCJleHAiOjE3"
    "NzgyMDkyMDB9.60oOAnp2eypywCvpxLKMEA7kVuFOE2DTndEf53wzS1g"
)
HEADERS = {
    "X-N8N-API-KEY": API_KEY,
    "Content-Type": "application/json",
}
PROMPT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs", "prompt-rica-completo-v2.md")
RICA_NODE_NAME = "Rica"


def gen_id():
    return str(uuid.uuid4())


# ── Helper: build a toolWorkflow node ───────────────────────────────────────
def make_tool_workflow(name, description, workflow_id, cached_name,
                       ai_params, context_params=None, position=(0, 0)):
    """
    ai_params: list of (param_name, description_text, type_str)
    context_params: dict {param_name: expression_string}  (no ={{ }} wrapper needed, raw expression)
    """
    value_map = {}
    schema = []
    for p_name, p_desc, p_type in ai_params:
        value_map[p_name] = "={{ $fromAI('" + p_name + "', `" + p_desc + "`, '" + p_type + "') }}"
        schema.append({
            "id": p_name,
            "displayName": p_name,
            "required": False,
            "defaultMatch": False,
            "display": True,
            "canBeUsedToMatch": True,
            "type": p_type,
        })
    if context_params:
        for p_name, expr in context_params.items():
            value_map[p_name] = "={{ " + expr + " }}"
            schema.append({
                "id": p_name,
                "displayName": p_name,
                "required": False,
                "defaultMatch": False,
                "display": True,
                "canBeUsedToMatch": True,
                "type": "string",
            })

    return {
        "parameters": {
            "description": description,
            "workflowId": {
                "__rl": True,
                "value": workflow_id,
                "mode": "list",
                "cachedResultName": cached_name,
            },
            "workflowInputs": {
                "mappingMode": "defineBelow",
                "value": value_map,
                "matchingColumns": [],
                "schema": schema,
                "attemptToConvertTypes": False,
                "convertFieldsToString": False,
            },
        },
        "type": "@n8n/n8n-nodes-langchain.toolWorkflow",
        "typeVersion": 2.2,
        "position": list(position),
        "id": gen_id(),
        "name": name,
    }


# ── Helper: build a toolHttpRequest node ────────────────────────────────────
def make_tool_http(name, description, url, method="GET",
                   query_params=None, placeholder_defs=None, position=(0, 0)):
    """
    query_params: list of {"name": ..., "value": ...}
    placeholder_defs: list of {"name": ..., "description": ...}
    """
    params = {
        "description": description,
        "method": method,
        "url": url,
        "sendHeaders": True,
        "headerParameters": {
            "parameters": [
                {"name": "Content-Type", "value": "application/json"}
            ]
        },
        "optimizeResponse": True,
        "jsonOutput": True,
    }
    if query_params:
        params["sendQuery"] = True
        params["queryParameters"] = {"parameters": query_params}
    if placeholder_defs:
        params["placeholderDefinitions"] = {"values": placeholder_defs}

    return {
        "parameters": params,
        "type": "@n8n/n8n-nodes-langchain.toolHttpRequest",
        "typeVersion": 1.1,
        "position": list(position),
        "id": gen_id(),
        "name": name,
    }


# ── Define the 14 new nodes ────────────────────────────────────────────────
X_START = 1168
X_STEP = 200

def pos(row, col):
    y_values = {0: 1600, 1: 1800, 2: 2000}
    return (X_START + col * X_STEP, y_values[row])


PHONE_CTX = {"contact_phone": "$('Get_Info').item.json.telefone"}

NEW_NODES = []

# ── Row 0: 5 toolWorkflow nodes ──
NEW_NODES.append(make_tool_workflow(
    name="crm_registrar_lead",
    description="Registra um novo lead no CRM. Use quando iniciar conversa com cliente novo. Identifica o funil correto pelo produto de interesse.",
    workflow_id="zAGzg93MjlebPaPf",
    cached_name="crm_registrar_lead",
    ai_params=[
        ("contact_name", "Nome do contato", "string"),
        ("pipeline_name", "Nome do funil/pipeline", "string"),
        ("deal_title", "Título do negócio", "string"),
        ("temperature", "Temperatura do lead: hot, warm, cold", "string"),
        ("contact_email", "Email do contato", "string"),
        ("company_name", "Nome da empresa", "string"),
        ("company_segment", "Segmento da empresa", "string"),
        ("company_city", "Cidade da empresa", "string"),
        ("company_state", "Estado da empresa", "string"),
    ],
    context_params=PHONE_CTX,
    position=pos(0, 0),
))

NEW_NODES.append(make_tool_workflow(
    name="crm_criar_deal",
    description="Cria um novo negócio no CRM para um contato existente. Use para cross-sell quando o contato já existe mas quer outro produto.",
    workflow_id="8oK9A9IMZupzszPi",
    cached_name="crm_criar_deal",
    ai_params=[
        ("title", "Título do negócio", "string"),
        ("contact_id", "ID do contato no CRM", "string"),
        ("company_id", "ID da empresa no CRM", "string"),
        ("pipeline_id", "ID do funil/pipeline", "string"),
        ("contact_name", "Nome do contato", "string"),
        ("temperature", "Temperatura do lead: hot, warm, cold", "string"),
    ],
    context_params=PHONE_CTX,
    position=pos(0, 1),
))

NEW_NODES.append(make_tool_workflow(
    name="crm_atualizar_lead",
    description="Atualiza dados de um negócio (deal) no CRM. Use para atualizar temperatura, valor, status ou dados do contato no negócio.",
    workflow_id="xSJ1toyBPv6IAXn7",
    cached_name="crm_atualizar_lead",
    ai_params=[
        ("deal_id", "ID do negócio no CRM", "string"),
        ("temperature", "Temperatura do lead: hot, warm, cold", "string"),
        ("value", "Valor do negócio", "string"),
        ("contact_name", "Nome do contato", "string"),
        ("contact_email", "Email do contato", "string"),
        ("company_name", "Nome da empresa", "string"),
        ("status", "Status do negócio: open, won, lost", "string"),
        ("lost_reason", "Motivo da perda do negócio", "string"),
    ],
    position=pos(0, 2),
))

NEW_NODES.append(make_tool_workflow(
    name="crm_atualizar_contato",
    description="Atualiza dados de um contato no CRM. Use quando o cliente informar nome, email, cargo ou empresa.",
    workflow_id="Lb6paMVtKZrpqpv9",
    cached_name="crm_atualizar_contato",
    ai_params=[
        ("contact_id", "ID do contato no CRM", "string"),
        ("name", "Nome do contato", "string"),
        ("email", "Email do contato", "string"),
        ("phone", "Telefone do contato", "string"),
        ("role", "Cargo do contato", "string"),
        ("company_id", "ID da empresa vinculada", "string"),
    ],
    position=pos(0, 3),
))

NEW_NODES.append(make_tool_workflow(
    name="crm_atualizar_empresa",
    description="Atualiza dados de uma empresa no CRM. Use após confirmar dados do CNPJ ou quando o cliente informar dados da empresa.",
    workflow_id="YTxsgeQVaAIDEVRS",
    cached_name="crm_atualizar_empresa",
    ai_params=[
        ("company_id", "ID da empresa no CRM", "string"),
        ("name", "Nome da empresa", "string"),
        ("cnpj", "CNPJ da empresa", "string"),
        ("segment", "Segmento da empresa", "string"),
        ("city", "Cidade da empresa", "string"),
        ("state", "Estado da empresa", "string"),
        ("phone", "Telefone da empresa", "string"),
        ("email", "Email da empresa", "string"),
        ("website", "Website da empresa", "string"),
    ],
    position=pos(0, 4),
))

# ── Row 1: 5 toolWorkflow nodes ──
NEW_NODES.append(make_tool_workflow(
    name="crm_consultar_cnpj",
    description="Consulta dados de empresa pelo CNPJ na Receita Federal via BrasilAPI. Use quando o cliente informar o CNPJ. Apresente os dados e peça confirmação antes de salvar.",
    workflow_id="alIjA2GwQcg8gPrP",
    cached_name="crm_consultar_cnpj",
    ai_params=[
        ("cnpj", "CNPJ da empresa (somente números)", "string"),
    ],
    position=pos(1, 0),
))

NEW_NODES.append(make_tool_workflow(
    name="crm_salvar_insight",
    description="Salva um insight individual sobre o negócio no CRM. Categorias: pain_point, need, budget, timeline, decision_maker, competitor, objection, positive_signal.",
    workflow_id="gABMFoLi752wJkzs",
    cached_name="crm_salvar_insight",
    ai_params=[
        ("deal_id", "ID do negócio no CRM", "string"),
        ("category", "Categoria do insight: pain_point, need, budget, timeline, decision_maker, competitor, objection, positive_signal", "string"),
        ("content", "Conteúdo do insight", "string"),
        ("confidence", "Nível de confiança: high, medium, low", "string"),
        ("raw_message", "Mensagem original do cliente", "string"),
    ],
    position=pos(1, 1),
))

NEW_NODES.append(make_tool_workflow(
    name="crm_salvar_insights_lote",
    description="Salva múltiplos insights de uma vez no CRM. Use para salvar vários insights coletados durante uma conversa. O insights_json deve ser um JSON com array de insights.",
    workflow_id="5aXDB8i15OPcbW4o",
    cached_name="crm_salvar_insights_lote",
    ai_params=[
        ("deal_id", "ID do negócio no CRM", "string"),
        ("insights_json", "JSON string com array de insights", "string"),
    ],
    position=pos(1, 2),
))

NEW_NODES.append(make_tool_workflow(
    name="crm_registrar_atividade",
    description="Registra uma atividade no negócio do CRM. Use para registrar interações como conversas, reuniões, envio de propostas. Tipos: whatsapp, call, email, meeting, proposal, note.",
    workflow_id="aNXWCEs8gthhN8zy",
    cached_name="crm_registrar_atividade",
    ai_params=[
        ("deal_id", "ID do negócio no CRM", "string"),
        ("type", "Tipo da atividade: whatsapp, call, email, meeting, proposal, note", "string"),
        ("description", "Descrição da atividade", "string"),
    ],
    position=pos(1, 3),
))

NEW_NODES.append(make_tool_workflow(
    name="crm_mover_estagio",
    description="Move um negócio para outro estágio no funil do CRM. Use quando o lead avança no pipeline (ex: de Qualificação para Proposta).",
    workflow_id="zZYAru6Og5Yskl5g",
    cached_name="crm_mover_estagio",
    ai_params=[
        ("deal_id", "ID do negócio no CRM", "string"),
        ("pipeline_stage_id", "ID do estágio de destino no funil", "string"),
    ],
    position=pos(1, 4),
))

# ── Row 2: 4 toolHttpRequest nodes ──
NEW_NODES.append(make_tool_http(
    name="crm_buscar_contato",
    description="Busca um contato no CRM pelo telefone. Retorna dados do contato, empresa vinculada e negócios. Use no início da conversa para verificar se o cliente já existe.",
    url="=https://sucessocrm.benitechlab.com/api/crm/contacts/by-phone/{{ $('Get_Info').item.json.telefone }}?organization_id=00000000-0000-0000-0000-000000000001",
    position=pos(2, 0),
))

NEW_NODES.append(make_tool_http(
    name="crm_buscar_deal",
    description="Busca detalhes de um negócio específico no CRM pelo ID. Retorna dados completos do deal incluindo estágio, atividades e insights.",
    url="=https://sucessocrm.benitechlab.com/api/crm/deals/{{ $fromAI('deal_id', `ID do negócio no CRM`) }}?organization_id=00000000-0000-0000-0000-000000000001",
    placeholder_defs=[
        {"name": "deal_id", "description": "ID do negócio no CRM"},
    ],
    position=pos(2, 1),
))

NEW_NODES.append(make_tool_http(
    name="crm_listar_funis",
    description="Lista todos os funis (pipelines) disponíveis no CRM com seus IDs. Use para obter o pipeline_id ao criar um novo deal.",
    url="https://sucessocrm.benitechlab.com/api/crm/pipelines?organization_id=00000000-0000-0000-0000-000000000001",
    position=pos(2, 2),
))

NEW_NODES.append(make_tool_http(
    name="crm_listar_estagios",
    description="Lista os estágios de um funil específico. Use para obter o pipeline_stage_id ao mover um deal.",
    url="=https://sucessocrm.benitechlab.com/api/crm/pipeline?organization_id=00000000-0000-0000-0000-000000000001&pipeline_id={{ $fromAI('pipeline_id', `ID do funil`) }}",
    placeholder_defs=[
        {"name": "pipeline_id", "description": "ID do funil"},
    ],
    position=pos(2, 3),
))


# ── Main ────────────────────────────────────────────────────────────────────
def main():
    # 1. GET current workflow
    print("[1/5] Fetching current workflow...")
    resp = requests.get(f"{API_BASE}/workflows/{WORKFLOW_ID}", headers=HEADERS)
    resp.raise_for_status()
    wf = resp.json()
    print(f"  OK — '{wf['name']}' with {len(wf['nodes'])} nodes")

    # 2. Read system prompt
    print("[2/5] Reading system prompt from file...")
    with open(PROMPT_FILE, "r", encoding="utf-8") as f:
        prompt_content = f.read()
    print(f"  OK — {len(prompt_content)} characters")

    # 3. Update Rica agent systemMessage
    print("[3/5] Updating Rica agent systemMessage...")
    rica_found = False
    for node in wf["nodes"]:
        if node["name"] == RICA_NODE_NAME:
            rica_found = True
            if "options" not in node["parameters"]:
                node["parameters"]["options"] = {}
            node["parameters"]["options"]["systemMessage"] = "=" + prompt_content
            print(f"  OK — Updated systemMessage on node '{RICA_NODE_NAME}'")
            break
    if not rica_found:
        print(f"  ERROR — Node '{RICA_NODE_NAME}' not found!")
        sys.exit(1)

    # 4. Add new nodes
    print(f"[4/5] Adding {len(NEW_NODES)} new CRM tool nodes...")
    existing_names = {n["name"] for n in wf["nodes"]}
    added = 0
    for node in NEW_NODES:
        if node["name"] in existing_names:
            print(f"  SKIP — '{node['name']}' already exists")
            continue
        wf["nodes"].append(node)
        added += 1
        print(f"  ADD  — '{node['name']}' ({node['type']})")

    # 5. Add connections for new nodes
    print(f"  Adding ai_tool connections to '{RICA_NODE_NAME}'...")
    if "connections" not in wf:
        wf["connections"] = {}
    for node in NEW_NODES:
        node_name = node["name"]
        if node_name not in existing_names:
            wf["connections"][node_name] = {
                "ai_tool": [[{
                    "node": RICA_NODE_NAME,
                    "type": "ai_tool",
                    "index": 0,
                }]]
            }

    print(f"  OK — {added} nodes added, {len(NEW_NODES) - added} skipped")

    # 6. PUT updated workflow
    print("[5/5] Sending PUT to update workflow...")
    payload = {
        "name": wf["name"],
        "nodes": wf["nodes"],
        "connections": wf["connections"],
        "settings": wf.get("settings", {}),
    }
    resp = requests.put(
        f"{API_BASE}/workflows/{WORKFLOW_ID}",
        headers=HEADERS,
        json=payload,
    )
    if resp.status_code == 200:
        result = resp.json()
        print(f"  OK — Workflow updated successfully!")
        print(f"  Total nodes now: {len(result['nodes'])}")
        # List the new CRM nodes
        crm_names = [n["name"] for n in NEW_NODES]
        found_in_result = [n["name"] for n in result["nodes"] if n["name"] in crm_names]
        print(f"  CRM nodes confirmed: {len(found_in_result)}/{len(crm_names)}")
    else:
        print(f"  ERROR — HTTP {resp.status_code}")
        print(f"  Response: {resp.text[:2000]}")
        sys.exit(1)

    print("\nDone!")


if __name__ == "__main__":
    main()
