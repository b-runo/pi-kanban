/**
 * ==============================================================================
 * Camada de Armazenamento - K-Off Kanban
 * Responsabilidade Única: Gerenciar a persistência local de dados no navegador
 * utilizando IndexedDB através da biblioteca Dexie.js.
 * 
 * Por que IndexedDB e não LocalStorage?
 * 1. O LocalStorage possui limite reduzido (em torno de 5MB a 10MB) e é síncrono,
 *    o que pode congelar a interface em operações maiores.
 * 2. O IndexedDB é assíncrono, operando em segundo plano sem travar a interface (UI),
 *    e suporta centenas de megabytes ou até gigabytes de dados com suporte a índices.
 * 3. A biblioteca Dexie.js fornece uma API ergonômica baseada em Promises sobre o IndexedDB.
 * ==============================================================================
 */

class BancoDeDadosLocal {
    /**
     * Construtor da classe BancoDeDadosLocal.
     * Inicializa o banco de dados Dexie e declara o armazenamento de objetos (Object Store).
     */
    constructor() {
        // Criamos ou conectamos ao banco de dados com nome em português
        this.banco = new Dexie("BancoKanbanOffline");

        // Versão 1: Esquema original com apenas a tabela 'cartoes'
        this.banco.version(1).stores({
            cartoes: "id, colunaAtual, ordem"
        });

        // Versão 2: Suporte a colunas dinâmicas persistidas no IndexedDB
        // 'id' é chave primária, 'ordem' é indexada para ordenação rápida
        this.banco.version(2).stores({
            cartoes: "id, colunaAtual, ordem",
            colunas: "id, ordem"
        });

        // Versão 3: Suporte a itens (tarefas) de cada cartão e data de entrega
        // 'itens_cartao' armazena as subtarefas vinculadas ao cartão pelo 'idCartao'
        this.banco.version(3).stores({
            cartoes: "id, colunaAtual, ordem",
            colunas: "id, ordem",
            itens_cartao: "id, idCartao, ordem"
        });

        // Versão 4: Suporte à coluna de prioridade no cartão ('alta', 'media' e 'baixa')
        this.banco.version(4).stores({
            cartoes: "id, colunaAtual, ordem, prioridade",
            colunas: "id, ordem",
            itens_cartao: "id, idCartao, ordem"
        }).upgrade(async (transacao) => {
            // Garante que cartões preexistentes sem prioridade definida recebam a prioridade padrão 'baixa'
            await transacao.cartoes.toCollection().modify((cartao) => {
                if (!cartao.prioridade || !BancoDeDadosLocal.PRIORIDADES_VALIDAS.includes(cartao.prioridade)) {
                    cartao.prioridade = "baixa";
                }
            });
        });

        // Versão 5: Suporte à coluna de cor de destaque ('cor_destaque') na tabela 'colunas'
        this.banco.version(5).stores({
            cartoes: "id, colunaAtual, ordem, prioridade",
            colunas: "id, ordem, cor_destaque",
            itens_cartao: "id, idCartao, ordem"
        }).upgrade(async (transacao) => {
            // Garante que colunas preexistentes recebam a cor padrão '#9E9E9E'
            await transacao.colunas.toCollection().modify((coluna) => {
                if (!coluna.cor_destaque) {
                    coluna.cor_destaque = "#9E9E9E";
                }
            });
        });

        // Versão 6: Suporte à tabela 'configuracoes' (tituloDoProjeto, tema)
        this.banco.version(6).stores({
            cartoes: "id, colunaAtual, ordem, prioridade",
            colunas: "id, ordem, cor_destaque",
            itens_cartao: "id, idCartao, ordem",
            configuracoes: "id"
        }).upgrade(async (transacao) => {
            const configExistente = await transacao.configuracoes.get("geral");
            if (!configExistente) {
                await transacao.configuracoes.put({
                    id: "geral",
                    tituloDoProjeto: "Meu Projeto",
                    tema: "light"
                });
            }
        });
    }

    /**
     * Lista de valores possíveis e válidos para a coluna 'prioridade'.
     *
     * @type {string[]}
     */
    static get PRIORIDADES_VALIDAS() {
        return ["alta", "media", "baixa"];
    }

    /**
     * Valida e normaliza o valor da prioridade do cartão, garantindo um dos possíveis valores:
     * 'alta', 'media' ou 'baixa'. Retorna 'baixa' por padrão caso seja omitido ou inválido.
     *
     * @param {string} [prioridade] - Nível de prioridade informado.
     * @returns {"alta" | "media" | "baixa"} Prioridade validada.
     */
    static normalizarPrioridade(prioridade) {
        const prioridadeTratada = typeof prioridade === "string" ? prioridade.toLowerCase().trim() : "";
        if (BancoDeDadosLocal.PRIORIDADES_VALIDAS.includes(prioridadeTratada)) {
            return prioridadeTratada;
        }
        return "baixa";
    }

    /**
     * Salva uma coluna ou lista de colunas no IndexedDB.
     *
     * @param {Coluna[] | Coluna} colunas - Array de colunas ou uma única coluna.
     * @returns {Promise<void>}
     */
    async salvarColunas(colunas) {
        try {
            const listaColunas = Array.isArray(colunas) ? colunas : [colunas];

            const objetosSimples = listaColunas.map((coluna) => ({
                id: coluna.id,
                titulo: String(coluna.titulo || "").toUpperCase(),
                ordem: Number(coluna.ordem) || 0,
                cor_destaque: coluna.cor_destaque || "#9E9E9E"
            }));

            await this.banco.colunas.bulkPut(objetosSimples);
        } catch (erro) {
            console.error("Erro ao salvar colunas no IndexedDB:", erro);
            throw erro;
        }
    }

    /**
     * Atualiza propriedades específicas de uma coluna sem sobrescrever o registro completo.
     * Operação atômica e performática utilizando o método update do Dexie.js.
     *
     * @param {string} id - Identificador único da coluna.
     * @param {Object} alteracoes - Objeto contendo os campos a serem atualizados (ex: { ordem: 2, titulo: 'FEITO' }).
     * @returns {Promise<number>} Quantidade de registros atualizados (1 para sucesso, 0 se não encontrado).
     */
    async atualizarPropriedadesColuna(id, alteracoes) {
        try {
            if (!id || !alteracoes || typeof alteracoes !== "object") {
                return 0;
            }

            const dadosTratados = { ...alteracoes };
            if (dadosTratados.ordem !== undefined) {
                dadosTratados.ordem = Number(dadosTratados.ordem) || 0;
            }
            if (dadosTratados.titulo !== undefined) {
                dadosTratados.titulo = String(dadosTratados.titulo || "").toUpperCase();
            }

            return await this.banco.colunas.update(id, dadosTratados);
        } catch (erro) {
            console.error(`Erro ao atualizar propriedades da coluna ${id} no IndexedDB:`, erro);
            throw erro;
        }
    }

    /**
     * Atualiza propriedades específicas de múltiplas colunas em uma única transação atômica.
     * Otimizado para reordenação de colunas via arrastar e soltar (Drag and Drop / Sortable.js).
     *
     * @param {Array<{id: string, alteracoes: Object}>} listaAlteracoes - Lista com id da coluna e propriedades a modificar.
     * @returns {Promise<void>}
     */
    async atualizarColunasEmLote(listaAlteracoes) {
        try {
            if (!Array.isArray(listaAlteracoes) || listaAlteracoes.length === 0) {
                return;
            }

            await this.banco.transaction("rw", this.banco.colunas, async () => {
                const promessas = listaAlteracoes.map((item) => {
                    const dadosTratados = { ...item.alteracoes };
                    if (dadosTratados.ordem !== undefined) {
                        dadosTratados.ordem = Number(dadosTratados.ordem) || 0;
                    }
                    if (dadosTratados.titulo !== undefined) {
                        dadosTratados.titulo = String(dadosTratados.titulo || "").toUpperCase();
                    }
                    return this.banco.colunas.update(item.id, dadosTratados);
                });

                await Promise.all(promessas);
            });
        } catch (erro) {
            console.error("Erro ao atualizar lote de colunas no IndexedDB:", erro);
            throw erro;
        }
    }

    /**
     * Carrega todas as colunas cadastradas no IndexedDB.
     * Trata o caso de o banco estar vazio retornando um array vazio.
     * Retorna um array de instâncias da classe Coluna ordenado por 'ordem'.
     *
     * @returns {Promise<Coluna[]>}
     */
    async carregarColunas() {
        try {
            const registros = await this.banco.colunas.toArray();

            if (!registros || registros.length === 0) {
                return [];
            }

            const listaDeColunas = registros.map((registro) => {
                const tituloMaiusculo = String(registro.titulo || "").toUpperCase();
                if (typeof Coluna !== "undefined") {
                    return new Coluna({
                        id: registro.id,
                        titulo: tituloMaiusculo,
                        ordem: registro.ordem,
                        cor_destaque: registro.cor_destaque || "#9E9E9E"
                    });
                }
                return {
                    ...registro,
                    titulo: tituloMaiusculo
                };
            });

            listaDeColunas.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

            return listaDeColunas;
        } catch (erro) {
            console.error("Erro ao carregar colunas do IndexedDB:", erro);
            return [];
        }
    }

    /**
     * Exclui uma coluna e opcionalmente remove os cartões vinculados a ela.
     *
     * @param {string} id - Identificador único da coluna.
     * @returns {Promise<void>}
     */
    async excluirColuna(id) {
        try {
            await this.banco.transaction("rw", this.banco.colunas, this.banco.cartoes, this.banco.itens_cartao, async () => {
                // Busca os cartões da coluna para também remover suas subtarefas em cascata
                const cartoesDaColuna = await this.banco.cartoes.where("colunaAtual").equals(id).toArray();
                const idsCartoes = cartoesDaColuna.map((c) => c.id);

                if (idsCartoes.length > 0) {
                    await this.banco.itens_cartao.where("idCartao").anyOf(idsCartoes).delete();
                }

                // Remove todos os cartões vinculados a essa coluna
                await this.banco.cartoes.where("colunaAtual").equals(id).delete();

                // Remove a coluna
                await this.banco.colunas.delete(id);
            });
        } catch (erro) {
            console.error(`Erro ao excluir a coluna ${id} do IndexedDB:`, erro);
            throw erro;
        }
    }

    /**
     * Salva uma lista de cartões no IndexedDB.
     * Aceita tanto um array de cartões quanto um único cartão.
     * 
     * @param {Cartao[] | Cartao} cartoes - Array de cartões ou um único cartão.
     * @returns {Promise<void>}
     */
    async salvarCartoes(cartoes) {
        try {
            // Se for passado um cartão individual, convertemos para array
            const listaCartoes = Array.isArray(cartoes) ? cartoes : [cartoes];

            // Mapeamos para objetos puros (plain objects) para garantir persistência limpa
            const objetosSimples = listaCartoes.map((cartao) => ({
                id: cartao.id,
                titulo: cartao.titulo,
                descricao: cartao.descricao || "",
                dataEntrega: cartao.dataEntrega || "",
                prioridade: BancoDeDadosLocal.normalizarPrioridade(cartao.prioridade),
                colunaAtual: cartao.colunaAtual,
                ordem: Number(cartao.ordem) || 0
            }));

            // bulkPut insere novos registros ou atualiza existentes pela chave primária 'id'
            await this.banco.cartoes.bulkPut(objetosSimples);
        } catch (erro) {
            console.error("Erro ao salvar cartões no IndexedDB:", erro);
            throw erro;
        }
    }

    /**
     * Atualiza propriedades específicas de um cartão sem sobrescrever o registro completo.
     * Operação atômica e performática utilizando o método update do Dexie.js.
     *
     * @param {string} id - Identificador único do cartão.
     * @param {Object} alteracoes - Objeto contendo os campos a serem atualizados (ex: { ordem: 2, colunaAtual: 'col-1' }).
     * @returns {Promise<number>} Quantidade de registros atualizados (1 para sucesso, 0 se não encontrado).
     */
    async atualizarPropriedadesCartao(id, alteracoes) {
        try {
            if (!id || !alteracoes || typeof alteracoes !== "object") {
                return 0;
            }

            const dadosTratados = { ...alteracoes };
            if (dadosTratados.prioridade !== undefined) {
                dadosTratados.prioridade = BancoDeDadosLocal.normalizarPrioridade(dadosTratados.prioridade);
            }
            if (dadosTratados.ordem !== undefined) {
                dadosTratados.ordem = Number(dadosTratados.ordem) || 0;
            }

            return await this.banco.cartoes.update(id, dadosTratados);
        } catch (erro) {
            console.error(`Erro ao atualizar propriedades do cartão ${id} no IndexedDB:`, erro);
            throw erro;
        }
    }

    /**
     * Atualiza propriedades específicas de múltiplos cartões em uma única transação atômica.
     * Otimizado para reordenação de cartões via arrastar e soltar (Drag and Drop / Sortable.js).
     *
     * @param {Array<{id: string, alteracoes: Object}>} listaAlteracoes - Lista com id do cartão e propriedades a modificar.
     * @returns {Promise<void>}
     */
    async atualizarCartoesEmLote(listaAlteracoes) {
        try {
            if (!Array.isArray(listaAlteracoes) || listaAlteracoes.length === 0) {
                return;
            }

            await this.banco.transaction("rw", this.banco.cartoes, async () => {
                const promessas = listaAlteracoes.map((item) => {
                    const dadosTratados = { ...item.alteracoes };
                    if (dadosTratados.prioridade !== undefined) {
                        dadosTratados.prioridade = BancoDeDadosLocal.normalizarPrioridade(dadosTratados.prioridade);
                    }
                    if (dadosTratados.ordem !== undefined) {
                        dadosTratados.ordem = Number(dadosTratados.ordem) || 0;
                    }
                    return this.banco.cartoes.update(item.id, dadosTratados);
                });

                await Promise.all(promessas);
            });
        } catch (erro) {
            console.error("Erro ao atualizar lote de cartões no IndexedDB:", erro);
            throw erro;
        }
    }

    /**
     * Carrega todos os cartões cadastrados no IndexedDB.
     * Trata o caso de o banco estar vazio retornando um array vazio.
     * Sempre retorna um array de instâncias da classe Cartao.
     * 
     * @returns {Promise<Cartao[]>}
     */
    async carregarCartoes() {
        try {
            // Obtém todos os registros da tabela 'cartoes'
            const registros = await this.banco.cartoes.toArray();

            // Tratamento explícito quando o banco de dados estiver vazio
            if (!registros || registros.length === 0) {
                return [];
            }

            // Converte cada registro do banco em uma instância válida da classe Cartao
            const listaDeCartoes = registros.map((registro) => {
                const prioridade = BancoDeDadosLocal.normalizarPrioridade(registro.prioridade);

                if (typeof Cartao !== "undefined") {
                    const instanciaCartao = new Cartao({
                        id: registro.id,
                        titulo: registro.titulo,
                        descricao: registro.descricao,
                        dataEntrega: registro.dataEntrega || "",
                        prioridade: prioridade,
                        colunaAtual: registro.colunaAtual,
                        ordem: registro.ordem
                    });
                    // Garante atribuição da prioridade mesmo em instâncias legadas de Cartao
                    instanciaCartao.prioridade = prioridade;
                    return instanciaCartao;
                }
                return {
                    ...registro,
                    prioridade: prioridade
                };
            });

            // Ordena os cartões respeitando a propriedade 'ordem'
            listaDeCartoes.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

            return listaDeCartoes;
        } catch (erro) {
            console.error("Erro ao carregar cartões do IndexedDB:", erro);
            // Em caso de erro na leitura, retorna array vazio para evitar quebras
            return [];
        }
    }

    /**
     * Carrega um cartão específico do IndexedDB pelo seu identificador.
     *
     * @param {string} id - Identificador único do cartão.
     * @returns {Promise<Cartao|null>} Instância do Cartão ou null caso não encontrado.
     */
    async carregarCartaoPorId(id) {
        try {
            if (!id) return null;
            const registro = await this.banco.cartoes.get(id);
            if (!registro) return null;

            const prioridade = BancoDeDadosLocal.normalizarPrioridade(registro.prioridade);

            if (typeof Cartao !== "undefined") {
                const instanciaCartao = new Cartao({
                    id: registro.id,
                    titulo: registro.titulo,
                    descricao: registro.descricao,
                    dataEntrega: registro.dataEntrega || "",
                    prioridade: prioridade,
                    colunaAtual: registro.colunaAtual,
                    ordem: registro.ordem
                });
                instanciaCartao.prioridade = prioridade;
                return instanciaCartao;
            }

            return {
                ...registro,
                prioridade: prioridade
            };
        } catch (erro) {
            console.error(`Erro ao carregar cartão ${id} do IndexedDB:`, erro);
            return null;
        }
    }

    /**
     * Exclui um cartão específico do banco de dados pelo identificador.
     * 
     * @param {string} id - Identificador único do cartão.
     * @returns {Promise<void>}
     */
    async excluirCartao(id) {
        try {
            await this.banco.transaction("rw", this.banco.cartoes, this.banco.itens_cartao, async () => {
                await this.banco.cartoes.delete(id);
                await this.banco.itens_cartao.where("idCartao").equals(id).delete();
            });
        } catch (erro) {
            console.error(`Erro ao excluir o cartão ${id} do IndexedDB:`, erro);
            throw erro;
        }
    }

    /**
     * Limpa completamente as tabelas de cartões e itens vinculados.
     *
     * @returns {Promise<void>}
     */
    async limparTodosCartoes() {
        try {
            await this.banco.transaction("rw", this.banco.cartoes, this.banco.itens_cartao, async () => {
                await this.banco.cartoes.clear();
                await this.banco.itens_cartao.clear();
            });
        } catch (erro) {
            console.error("Erro ao limpar os cartões do banco de dados:", erro);
            throw erro;
        }
    }

    /**
     * Salva um item/subtarefa no IndexedDB.
     *
     * @param {ItemCartao | Object} item - Objeto da subtarefa a ser persistida.
     * @returns {Promise<void>}
     */
    async salvarItemCartao(item) {
        try {
            const objetoSimples = {
                id: item.id,
                idCartao: item.idCartao,
                descricao: item.descricao || "",
                concluido: Boolean(item.concluido),
                ordem: Number(item.ordem) || 0
            };

            await this.banco.itens_cartao.put(objetoSimples);
        } catch (erro) {
            console.error("Erro ao salvar item do cartão no IndexedDB:", erro);
            throw erro;
        }
    }

    /**
     * Salva múltiplos itens/subtarefas de cartões no IndexedDB em lote.
     *
     * @param {ItemCartao[] | Object[]} itens - Lista de subtarefas.
     * @returns {Promise<void>}
     */
    async salvarItensCartao(itens) {
        try {
            const listaItens = Array.isArray(itens) ? itens : [itens];
            const objetosSimples = listaItens.map((item) => ({
                id: item.id,
                idCartao: item.idCartao,
                descricao: item.descricao || "",
                concluido: Boolean(item.concluido),
                ordem: Number(item.ordem) || 0
            }));

            await this.banco.itens_cartao.bulkPut(objetosSimples);
        } catch (erro) {
            console.error("Erro ao salvar itens do cartão no IndexedDB:", erro);
            throw erro;
        }
    }

    /**
     * Atualiza propriedades específicas de um item/subtarefa sem sobrescrever o registro completo.
     * Operação atômica e performática utilizando o método update do Dexie.js.
     *
     * @param {string} id - Identificador único do item.
     * @param {Object} alteracoes - Objeto contendo os campos a serem atualizados (ex: { concluido: true, descricao: 'Nova descrição' }).
     * @returns {Promise<number>} Quantidade de registros atualizados (1 para sucesso, 0 se não encontrado).
     */
    async atualizarPropriedadesItemCartao(id, alteracoes) {
        try {
            if (!id || !alteracoes || typeof alteracoes !== "object") {
                return 0;
            }

            const dadosTratados = { ...alteracoes };
            if (dadosTratados.ordem !== undefined) {
                dadosTratados.ordem = Number(dadosTratados.ordem) || 0;
            }
            if (dadosTratados.concluido !== undefined) {
                dadosTratados.concluido = Boolean(dadosTratados.concluido);
            }
            if (dadosTratados.descricao !== undefined) {
                dadosTratados.descricao = String(dadosTratados.descricao || "");
            }

            return await this.banco.itens_cartao.update(id, dadosTratados);
        } catch (erro) {
            console.error(`Erro ao atualizar propriedades do item ${id} no IndexedDB:`, erro);
            throw erro;
        }
    }

    /**
     * Carrega todos os itens/subtarefas vinculados a um cartão específico, ordenados por 'ordem'.
     *
     * @param {string} idCartao - Identificador do cartão.
     * @returns {Promise<ItemCartao[]>} Lista de instâncias de ItemCartao.
     */
    async carregarItensPorCartao(idCartao) {
        try {
            const registros = await this.banco.itens_cartao
                .where("idCartao")
                .equals(idCartao)
                .sortBy("ordem");

            if (!registros || registros.length === 0) {
                return [];
            }

            return registros.map((registro) => {
                if (typeof ItemCartao !== "undefined") {
                    return new ItemCartao({
                        id: registro.id,
                        idCartao: registro.idCartao,
                        descricao: registro.descricao,
                        concluido: registro.concluido,
                        ordem: registro.ordem
                    });
                }
                return registro;
            });
        } catch (erro) {
            console.error(`Erro ao carregar itens do cartão ${idCartao} do IndexedDB:`, erro);
            return [];
        }
    }

    /**
     * Carrega todos os itens/subtarefas cadastrados no IndexedDB.
     * Utilizado para pré-carregamento em lote na renderização de alto desempenho do quadro.
     *
     * @returns {Promise<Array<{id: string, idCartao: string, descricao: string, concluido: boolean, ordem: number}>>}
     */
    async carregarTodosItensCartao() {
        try {
            const registros = await this.banco.itens_cartao.toArray();
            return registros || [];
        } catch (erro) {
            console.error("Erro ao carregar todos os itens do cartão do IndexedDB:", erro);
            return [];
        }
    }

    /**
     * Exclui um item/subtarefa específico do IndexedDB.
     *
     * @param {string} id - Identificador do item.
     * @returns {Promise<void>}
     */
    async excluirItemCartao(id) {
        try {
            await this.banco.itens_cartao.delete(id);
        } catch (erro) {
            console.error(`Erro ao excluir item ${id} do IndexedDB:`, erro);
            throw erro;
        }
    }

    /**
     * Carrega as configurações do aplicativo do IndexedDB.
     * Retorna a configuração padrão caso ainda não exista no banco.
     *
     * @returns {Promise<{id: string, tituloDoProjeto: string, tema: "dark" | "light"}>}
     */
    async carregarConfiguracoes() {
        try {
            let config = await this.banco.configuracoes.get("geral");
            if (!config) {
                config = {
                    id: "geral",
                    tituloDoProjeto: "Meu Projeto",
                    tema: "light"
                };
                await this.banco.configuracoes.put(config);
            }
            return config;
        } catch (erro) {
            console.error("Erro ao carregar configurações do IndexedDB:", erro);
            return {
                id: "geral",
                tituloDoProjeto: "Meu Projeto",
                tema: "light"
            };
        }
    }

    /**
     * Atualiza as configurações do aplicativo no IndexedDB.
     *
     * @param {Object} alteracoes - Propriedades a serem atualizadas (ex: { tituloDoProjeto: "Novo Título", tema: "dark" }).
     * @returns {Promise<{id: string, tituloDoProjeto: string, tema: "dark" | "light"}>} Configuração atualizada.
     */
    async atualizarConfiguracoes(alteracoes) {
        try {
            if (!alteracoes || typeof alteracoes !== "object") {
                return await this.carregarConfiguracoes();
            }

            const configAtual = await this.carregarConfiguracoes();
            const configAtualizada = {
                ...configAtual,
                ...alteracoes,
                id: "geral"
            };

            await this.banco.configuracoes.put(configAtualizada);
            return configAtualizada;
        } catch (erro) {
            console.error("Erro ao atualizar configurações no IndexedDB:", erro);
            throw erro;
        }
    }

    /**
     * Salva as configurações do aplicativo no IndexedDB (alias para atualizarConfiguracoes).
     *
     * @param {Object} alteracoes - Propriedades a serem atualizadas.
     * @returns {Promise<{id: string, tituloDoProjeto: string, tema: "dark" | "light"}>}
     */
    async salvarConfiguracoes(alteracoes) {
        return await this.atualizarConfiguracoes(alteracoes);
    }
}

// Expõe a classe globalmente no navegador
if (typeof window !== "undefined") {
    window.BancoDeDadosLocal = BancoDeDadosLocal;
}

// Suporte a módulos CommonJS
if (typeof module !== "undefined" && module.exports) {
    module.exports = { BancoDeDadosLocal };
}
