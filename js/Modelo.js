/**
 * ==============================================================================
 * Camada de Modelo (Model) - K-Off Kanban
 * Responsabilidade Única: Representar as entidades de dados centrais do sistema
 * (o Cartão e a Coluna).
 *
 * Por que usamos classes?
 * No paradigma de Orientação a Objetos e no princípio de responsabilidade única (SOLID),
 * as classes Cartao e Coluna servem como "moldes" para garantir que toda entidade
 * criada no sistema tenha os mesmos atributos e uma estrutura consistente antes
 * de ser salva no banco de dados ou exibida na interface.
 * ==============================================================================
 */

class Coluna {
    /**
     * Construtor da classe Coluna.
     *
     * @param {Object} dados - Objeto contendo os dados iniciais da coluna.
     * @param {string} [dados.id] - Identificador único. Se não for fornecido, geramos automaticamente.
     * @param {string} dados.titulo - O título visível da coluna (ex: 'A Fazer').
     * @param {number} [dados.ordem=0] - A posição ordinal da coluna no quadro Kanban.
     * @param {string} [dados.cor_destaque="#9E9E9E"] - A cor de destaque hexadecimal da coluna.
     */
    constructor({ id, titulo, ordem = 0, cor_destaque = "#9E9E9E" }) {
        this.id = id || Coluna.gerarIdentificadorUnico();
        this.titulo = titulo;
        this.ordem = Number(ordem) || 0;
        this.cor_destaque = cor_destaque || "#9E9E9E";
    }

    /**
     * Gera um identificador único simples para a coluna.
     *
     * @returns {string} Identificador único.
     */
    static gerarIdentificadorUnico() {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
        }
        return "coluna-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9);
    }
}

class Cartao {
    /**
     * Lista com os valores possíveis para o atributo de prioridade do cartão.
     *
     * @type {string[]}
     */
    static get PRIORIDADES_VALIDAS() {
        return ["alta", "media", "baixa"];
    }

    /**
     * Construtor da classe Cartao.
     *
     * @param {Object} dados - Objeto contendo os dados iniciais do cartão.
     * @param {string} [dados.id] - Identificador único. Se não for fornecido, geramos automaticamente.
     * @param {string} dados.titulo - O título ou texto principal da tarefa.
     * @param {string} [dados.descricao=""] - Detalhes adicionais sobre a tarefa.
     * @param {string} [dados.dataEntrega=""] - Data de entrega da tarefa (formato YYYY-MM-DD).
     * @param {string} [dados.prioridade="baixa"] - Nível de prioridade ('alta', 'media' ou 'baixa').
     * @param {string} dados.colunaAtual - O identificador da coluna em que o cartão se encontra (ex: 'a-fazer').
     * @param {number} [dados.ordem=0] - A posição numérica do cartão na coluna para manter a ordenação.
     */
    constructor({ id, titulo, descricao = "", dataEntrega = "", prioridade = "baixa", colunaAtual, ordem = 0 }) {
        // O id precisa ser único para permitir buscar, atualizar e deletar o item no banco de dados.
        // Usamos crypto.randomUUID() se disponível ou geramos baseado no timestamp.
        this.id = id || Cartao.gerarIdentificadorUnico();

        // O título é obrigatório para dar nome à tarefa no Kanban.
        this.titulo = titulo;

        // A descrição detalha a tarefa (opcional).
        this.descricao = descricao;

        // Data de entrega (opcional).
        this.dataEntrega = dataEntrega;

        // Prioridade da tarefa: 'alta', 'media' ou 'baixa' (padrão: 'baixa')
        const prioridadeNormalizada = typeof prioridade === "string" ? prioridade.toLowerCase().trim() : "";
        this.prioridade = Cartao.PRIORIDADES_VALIDAS.includes(prioridadeNormalizada)
            ? prioridadeNormalizada
            : "baixa";

        // A coluna atual define em qual estágio do fluxo Kanban o cartão está ('a-fazer', 'em-progresso', etc).
        this.colunaAtual = colunaAtual;

        // A ordem define a posição vertical do cartão dentro da sua coluna atual.
        this.ordem = ordem;
    }

    /**
     * Gera um identificador único simples para o cartão.
     * Por que essa função existe?
     * Para que o cartão seja independente e consiga criar seu próprio ID caso um
     * não tenha sido fornecido externamente ou recuperado do banco de dados.
     *
     * @returns {string} Identificador único.
     */
    static gerarIdentificadorUnico() {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
        }
        // Alternativa segura caso o navegador não suporte randomUUID:
        return "cartao-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9);
    }
}

class ItemCartao {
    /**
     * Construtor da classe ItemCartao.
     *
     * @param {Object} dados - Objeto contendo os dados do item/subtarefa.
     * @param {string} [dados.id] - Identificador único da subtarefa.
     * @param {string} dados.idCartao - Identificador do cartão ao qual a subtarefa pertence.
     * @param {string} [dados.descricao=""] - Descrição ou texto da subtarefa.
     * @param {boolean} [dados.concluido=false] - Indica se o item foi concluído.
     * @param {number} [dados.ordem=0] - A posição sequencial do item dentro do cartão.
     */
    constructor({ id, idCartao, descricao = "", concluido = false, ordem = 0 }) {
        this.id = id || ItemCartao.gerarIdentificadorUnico();
        this.idCartao = idCartao;
        this.descricao = descricao;
        this.concluido = Boolean(concluido);
        this.ordem = Number(ordem) || 0;
    }

    /**
     * Gera um identificador único simples para o item do cartão.
     *
     * @returns {string} Identificador único.
     */
    static gerarIdentificadorUnico() {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
        }
        return "item-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9);
    }
}

// Tornamos as classes acessíveis globalmente no navegador
if (typeof window !== "undefined") {
    window.Coluna = Coluna;
    window.Cartao = Cartao;
    window.ItemCartao = ItemCartao;
}

// Suporte para ambientes modulares caso venha a ser importado
if (typeof module !== "undefined" && module.exports) {
    module.exports = { Coluna, Cartao, ItemCartao };
}
