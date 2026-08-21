/**
 * Markdown → styled dark-theme JSX, shared by the wiki and the blog.
 *
 * Element styling is written out per tag rather than pulled from a typography
 * plugin: this content is heavy on code samples and tables, both of which
 * want specific treatment on a dark background, and an explicit map is easier
 * to adjust than a plugin's cascade.
 *
 * The only thing that differs between callers is how a link target becomes a
 * URL — wiki pages resolve relative `.md` paths against `docs/wiki`, posts
 * mostly link outward — so `resolveHref` is injected. Everything else is
 * identical and stays identical.
 *
 * Rendered on the server: no `"use client"`, so published pages ship the
 * markup and none of the markdown machinery.
 */

import Link from "next/link";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from "react";

/** Heading text → anchor id (`The coordinate grid` → `the-coordinate-grid`). */
export function headingId(children: ReactNode): string {
  return flattenText(children)
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function flattenText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (typeof node === "object" && "props" in node) {
    return flattenText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

function Anchored({
  as: Tag,
  className,
  children,
}: {
  as: "h2" | "h3" | "h4";
  className: string;
  children: ReactNode;
}): ReactElement {
  const id = headingId(children);
  const label = flattenText(children);
  return (
    <Tag id={id} aria-label={label} className={`group scroll-mt-24 ${className}`}>
      {children}
      <a
        href={`#${id}`}
        aria-label="Link to this section"
        className="ml-2 text-gray-600 opacity-0 transition-opacity group-hover:opacity-100"
      >
        #
      </a>
    </Tag>
  );
}

const LINK_CLASS =
  "text-teal-400 underline decoration-teal-800 underline-offset-2 hover:text-teal-300";

export interface ContentMarkdownProps {
  /** Markdown source, frontmatter already stripped. */
  body: string;
  /** Maps a raw markdown href to its final URL. Defaults to identity. */
  resolveHref?: (href: string) => string;
}

export default function ContentMarkdown({
  body,
  resolveHref = (href) => href,
}: ContentMarkdownProps): ReactElement {
  return (
    <div className="text-[15px] leading-7 text-gray-300">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => (
            <Anchored
              as="h2"
              className="mb-3 mt-10 border-b border-gray-800 pb-2 text-2xl font-bold text-white"
            >
              {children}
            </Anchored>
          ),
          h3: ({ children }) => (
            <Anchored as="h3" className="mb-2 mt-8 text-lg font-semibold text-white">
              {children}
            </Anchored>
          ),
          h4: ({ children }) => (
            <Anchored as="h4" className="mb-2 mt-6 text-base font-semibold text-gray-200">
              {children}
            </Anchored>
          ),
          p: ({ children }) => <p className="my-4">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-4 list-disc space-y-1.5 pl-6 marker:text-gray-600">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-4 list-decimal space-y-1.5 pl-6 marker:text-gray-600">
              {children}
            </ol>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-gray-100">{children}</strong>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-4 border-l-2 border-teal-700 bg-gray-800/40 py-1 pl-4 text-gray-400">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-8 border-gray-800" />,
          img: ({ src, alt }) => (
            // Plain <img>: post images are authored in markdown with unknown
            // dimensions, which next/image requires. Lazy-loaded instead.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={typeof src === "string" ? src : ""}
              alt={alt ?? ""}
              loading="lazy"
              className="my-6 w-full rounded-lg border border-gray-800"
            />
          ),
          a: ({ href, children }) => {
            const resolved = resolveHref(href ?? "");
            const internal = resolved.startsWith("/") || resolved.startsWith("#");
            if (internal) {
              return (
                <Link href={resolved} className={LINK_CLASS}>
                  {children}
                </Link>
              );
            }
            return (
              <a
                href={resolved}
                target="_blank"
                rel="noreferrer noopener"
                className={LINK_CLASS}
              >
                {children}
              </a>
            );
          },
          // `pre` owns the block-code frame; `code` styles inline code and
          // stays transparent inside a `pre` so the two don't double up.
          pre: ({ children }) => (
            <pre className="my-5 overflow-x-auto rounded-lg border border-gray-800 bg-gray-950 p-4 font-mono text-[13px] leading-6 text-gray-300">
              {children}
            </pre>
          ),
          code: ({ children, ...props }: ComponentPropsWithoutRef<"code">) => {
            const inline = !String(props.className ?? "").includes("language-");
            return inline ? (
              <code className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[13px] text-teal-300">
                {children}
              </code>
            ) : (
              <code className="font-mono">{children}</code>
            );
          },
          // Tables are wide by nature; scroll the table, never the page.
          table: ({ children }) => (
            <div className="my-5 overflow-x-auto rounded-lg border border-gray-800">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-gray-800/60">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-gray-800 px-3 py-2 text-left font-semibold text-gray-200">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-gray-800/60 px-3 py-2 align-top">{children}</td>
          ),
        }}
      >
        {body}
      </Markdown>
    </div>
  );
}
