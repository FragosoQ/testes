# Reconhecimento de Países em Português

## 📋 Descrição

O sistema foi atualizado para reconhecer nomes de países em **português** além dos nomes em inglês. Isso cria uma redundância que permite buscar países usando seus nomes em português.

## 🔧 Como Funciona

A função `getCountry()` em `assets/data/processing.js` foi aprimorada com 3 níveis de busca:

### 1. **Busca Exata (original)**
   - Busca pelo nome exato do país (e.g., "Thailand")
   - Case-insensitive

### 2. **Busca por Mapeamento Português**
   - Consulta o arquivo `assets/data/portuguese-country-names.js`
   - Mapeia nomes em português para nomes em inglês
   - Exemplo: "tailândia" → "Thailand"

### 3. **Busca por Correspondência (fuzzy)**
   - Remove acentos do nome de entrada
   - Compara com nomes de países sem acentos
   - Permite variações como "Tailandia" = "Thailand"

## 📚 Exemplos de Uso

```javascript
// Agora todas essas buscas funcionam:
getCountry('Thailand', countries);      // ✅ Nome original
getCountry('tailândia', countries);     // ✅ Português com acentos
getCountry('Tailandia', countries);     // ✅ Português sem acentos
getCountry('TAILÂNDIA', countries);     // ✅ Case-insensitive
getCountry('tailandia', countries);     // ✅ Minúsculas
```

## 🌍 Países Suportados

O arquivo `portuguese-country-names.js` contém mapeamento para:

- **América do Sul**: Brasil, Argentina, Colômbia, Lima, Peru, etc.
- **América do Norte**: México, Canadá, Estados Unidos, Groenlândia, Islândia
- **Europa**: Portugal, Espanha, Alemanha, França, Itália, Grécia, Sérvia, Croácia, Roménia, Dinamarca, Ucrânia, Noruega
- **Ásia**: Tailândia, Vietnã, Índia, Paquistão, Nepal, Camboja, etc.
- **África**: Nigéria, Quênia, Madagascar, Etiópia, Somália, etc.
- **Oceania**: Fiji, Tonga, Nauru, Ilhas Salomão, Tuvalu, etc.

## 📝 Adicionando Novos Países

Para adicionar suporte a um novo país em português:

1. Abra `assets/data/portuguese-country-names.js`
2. Adicione uma linha com o padrão:
   ```javascript
   'nome_em_portugues_sem_acentos': 'NomeEmIngles',
   'franca': 'France',
   ```
3. A chave deve ser **minúscula sem acentos**
4. O valor deve ser o **nome exato do país** conforme está em `countries.all.json`

## 🔗 Arquivos Relacionados

- **`assets/data/portuguese-country-names.js`** - Mapeamento de nomes em português
- **`assets/data/processing.js`** - Função `getCountry()` com lógica de busca aprimorada
- **`assets/data/countries.all.json`** - Base de dados de países

## ✨ Benefícios

✅ Interface em português mais intuitiva  
✅ Busca flexível com/sem acentos  
✅ Compatibilidade regressiva mantida  
✅ Fácil expansão para outros idiomas  
