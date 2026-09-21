workspace "Shop" "A microservices storefront" {

    !identifiers hierarchical

    model {
        customer = person "Customer"

        web = softwareSystem "Storefront" "React SPA on S3 behind CloudFront" {
            cdn    = container "CloudFront" "CDN, edge cache" "Amazon CloudFront" "Amazon Web Services - CloudFront"
            bucket = container "React SPA" "Static site" "Amazon S3" "Amazon Web Services - Simple Storage Service"
            cdn -> bucket "origin"
        }

        // A single component with no internals: in C4 that is still a software system.
        gw = softwareSystem "Edge Gateway" "API Gateway, REST" "Amazon Web Services - API Gateway"

        catalog = softwareSystem "Catalog Service" "Products, browse and search" "Public" {
            api  = container "Catalog API" "" "Lambda, Node 20" "Amazon Web Services - Lambda"
            db   = container "Products" "" "DynamoDB" "Amazon Web Services - DynamoDB"
            idx  = container "Product Index" "" "OpenSearch" "Amazon Web Services - OpenSearch Service"
            sync = container "Index Sync" "" "Lambda, stream consumer" "Amazon Web Services - Lambda"

            api -> db
            api -> idx "search"
            db -> sync "product stream" "" "Async"
            sync -> idx "reindex"
        }

        orders = softwareSystem "Order Service" "Cart, checkout, fulfillment" "PCI" {
            api    = container "Orders API" "" "Lambda, Node 20" "Amazon Web Services - Lambda"
            db     = container "Orders" "" "DynamoDB" "Amazon Web Services - DynamoDB"
            queue  = container "Fulfillment Queue" "" "SQS FIFO" "Amazon Web Services - Simple Queue Service"
            worker = container "Fulfillment Worker" "" "Lambda, batch 10" "Amazon Web Services - Lambda"

            api -> db
            api -> queue "enqueue" "" "Async"
            queue -> worker "" "" "Async"
            worker -> db "mark shipped"
        }

        accounts = softwareSystem "Account Service" "Identity and profiles" "PCI" {
            api = container "Accounts API" "" "Lambda, Node 20" "Amazon Web Services - Lambda"
            db  = container "Accounts DB" "" "RDS Postgres 16" "Amazon Web Services - RDS"
            api -> db
        }

        // cross-service wiring
        customer -> web.cdn "browses"
        web.cdn -> gw "REST /api"

        gw -> catalog.api "browse"
        gw -> orders.api "checkout"
        gw -> accounts.api "profile"

        orders.api -> catalog.api "price check"
        orders.worker -> catalog.api "decrement stock"
        orders.api -> accounts.api "verify identity"
    }

    views {
        systemLandscape "landscape" "Storefront - landscape" {
            include *
            autoLayout tb 100 600
        }

        // A container view is scoped to one system, but may include containers of others.
        container orders "full" "Storefront - full detail" {
            include customer gw
            include element.type==container
            autoLayout tb 100 900
        }

        styles {
            element "Person" {
                shape person
            }
            element "PCI" {
                stroke #d13212
            }
            relationship "Relationship" {
                style solid
            }
            relationship "Async" {
                style dashed
            }
        }

        theme https://static.structurizr.com/themes/amazon-web-services-2023.01.31/theme.json
    }
}
