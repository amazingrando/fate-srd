import * as fs from "fs";
import * as globby from "globby";
import * as marked from "marked";
import { AST, parse } from "parse5";
import * as path from "path";
import * as util from "util";

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

function isComment(node: AST.Default.Node): node is AST.Default.CommentNode {
    return node.nodeName === "#comment";
}

function isDocument(node: AST.Default.Node): node is AST.Default.Document {
    return node.nodeName === "#document";
}

function isDocumentType(
    node: AST.Default.Node
): node is AST.Default.DocumentType {
    return node.nodeName === "#documentType";
}

function isElement(node: AST.Default.Node): node is AST.Default.Element {
    return node.nodeName[0] !== "#";
}

function isText(node: AST.Default.Node): node is AST.Default.TextNode {
    return node.nodeName === "#text";
}

function traverse(node: AST.Default.ParentNode): string {
    return node.childNodes.map(serialize).join("");
}

function skip(_: AST.Default.Node): string {
    return "";
}

function section(content: string): string {
    return `${content}\n\n`;
}

function classNames(node: AST.Default.Element): string[] {
    return node.attrs.reduce(
        (classes, attr) => {
            return attr.name === "class" ? attr.value.split(" ") : classes;
        },
        [] as string[]
    );
}

function heading(node: AST.Default.Element, level: number): string {
    return section(`${"#".repeat(level)} ${traverse(node)}`);
}

function blockquote(node: AST.Default.Element): string {
    return section(`> ${traverse(node)}`);
}

function paragraph(node: AST.Default.Element): string {
    const classes = classNames(node);
    const header = classes.find(
        className => className.match(/Heading-\d$/) !== null
    );
    if (header) {
        return heading(node, parseInt(header[header.length - 1]));
    }
    const example = classes.find(
        className => className.match(/^Example/) !== null
    );
    if (example) {
        return blockquote(node);
    }
    return section(traverse(node));
}

function link(node: AST.Default.Element): string {
    const href = node.attrs.find(attr => attr.name === "href");
    return href !== undefined && href.value[0] !== "#"
        ? `[${traverse(node)}](${href.value})`
        : traverse(node);
}

function emphasis(content: string): string {
    return `_${content}_`;
}

function strong(content: string): string {
    return `__${content}__`;
}

function strike(content: string): string {
    return `~~${content}~~`;
}

function span(node: AST.Default.Element): string {
    const classes = classNames(node);
    const content = traverse(node);
    if (
        classes.find(className => {
            return className === "Strong" || className === "CC-BY_Strong";
        })
    ) {
        return strong(content);
    }
    if (
        classes.find(className => {
            return (
                className === "Emphasis" ||
                className === "Book-Title" ||
                className === "Term" ||
                className === "CC-BY_Term"
            );
        })
    ) {
        return emphasis(content);
    }
    return content;
}

function item(node: AST.Default.Element): string {
    let curr = node;
    while (isElement(curr) && curr.tagName !== "ol" && curr.tagName === "ul") {
        curr = curr.parentNode as AST.Default.Element;
    }
    const ordered = curr.tagName === "ol";
    return `\n${ordered ? "1." : "-"} ${traverse(node)}`;
}

function table(node: AST.Default.Element): string {
    const rows = node.childNodes.filter(node => isElement(node))
    const first = rows[0];
    if (isElement(first) && first.tagName === "tr") {
        let title = row(first);
        let traversal: AST.Default.ParentNode = {
            childNodes: rows
        };
        // Special case for the ladder
        if (title.startsWith("\n| +")) {
            title = "\n| Number | Adjective |";
        } else {
            traversal = {
                childNodes: rows.slice(1)
            };
        }
        const columns = title.split("|").length - 2;
        return `${title}\n${"|-".repeat(columns)}|${traverse(traversal)}`;
    }
    console.log(node);
    throw new Error("Table without row as first child");
}

function row(node: AST.Default.Element): string {
    return `\n${traverse(node)} |`;
}

function cell(node: AST.Default.Element): string {
    return `| ${traverse(node).trim()} `;
}

function serialize(node: AST.Default.Node): string {
    if (isDocument(node)) {
        return traverse(node);
    }
    if (isComment(node) || isDocumentType(node)) {
        return skip(node);
    }
    if (isText(node)) {
        const text = node.value.replace(/\n/g, "");
        return text.match(/^\s+$/) ? "" : text;
    }
    if (isElement(node)) {
        switch (node.tagName) {
            case "head":
            case "iframe":
            case "br":
            case "colgroup":
            case "o:p":
                return skip(node);
            case "html":
            case "body":
            case "div":
                return traverse(node);
            case "ol":
            case "ul":
            case "table":
                return section(traverse(node));
            case "h1":
            case "h2":
            case "h3":
            case "h4":
            case "h5":
            case "h6":
                return heading(node, parseInt(node.tagName[1]));
            case "p":
                return paragraph(node);
            case "span":
                return span(node);
            case "li":
                return item(node);
            case "a":
                return link(node);
            case "hr":
                return section("---");
            case "b":
                return strong(traverse(node));
            case "i":
                return emphasis(traverse(node));
            case "strike":
                return strike(traverse(node));
            case "tbody":
                return table(node);
            case "tr":
                return row(node);
            case "td":
                return cell(node);
        }
    }
    throw new Error(`Unhandled Node: ${node.nodeName}`);
}

async function transform(filename: string): Promise<void> {
    const content = await readFile(filename, "utf8");
    const markdown = serialize(parse(content) as AST.Default.Document);
    const basename = path.basename(filename);
    await Promise.all([
        writeFile(
            path.join(
                __dirname,
                "docs",
                "markdown",
                basename.replace(".html", ".md")
            ),
            markdown
        ),
        writeFile(
            path.join(__dirname, "docs", "html", basename),
            marked(markdown)
        )
    ]);
}

async function main(): Promise<void> {
    const sources = await globby(path.join(__dirname, "source", "*.html"));
    await Promise.all(sources.map(transform));
}

function panic(err: Error): void {
    console.error(err);
    process.exit(1);
}

if (require.main === module) {
    main().catch(panic);
}
