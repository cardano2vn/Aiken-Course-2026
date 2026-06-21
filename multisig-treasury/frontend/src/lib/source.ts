import { docs } from "fumadocs-mdx:collections/server";
import { loader } from "fumadocs-core/source";
import { routers } from "@/constants/routers";

export const source = loader({
    baseUrl: routers.documentation,
    source: docs.toFumadocsSource(),
});
