import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";

export default function Layout({ children }: LayoutProps<"/documentation">) {
    return (
        <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
            <div className="docs-isolated-container relative">
                <div className="fixed left-[-200px] top-1/2 -translate-y-1/2 z-0 opacity-3 pointer-events-none select-none block"></div>
                {children}
            </div>
        </DocsLayout>
    );
}
