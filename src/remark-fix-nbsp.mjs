import { visit } from 'unist-util-visit';

// O editor rich-text do Decap CMS às vezes grava espaço-fixo (U+00A0) ao colar
// texto de Word/Google Docs. Isso impede a quebra de linha e estoura o layout
// (rolagem horizontal). Normaliza para espaço comum em todo o conteúdo Markdown/MDX.
export default function remarkFixNbsp() {
  return (tree) => {
    visit(tree, 'text', (node) => {
      if (node.value.includes(' ')) {
        node.value = node.value.replace(/ /g, ' ');
      }
    });
  };
}
