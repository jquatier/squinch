from diagrams import Node, Cluster, Diagram, Edge
from diagrams.azure.identity import Users as User  # AWS's user icon is dark-on-transparent
from diagrams.aws.network import CloudFront, APIGateway
from diagrams.aws.storage import S3
from diagrams.aws.compute import Lambda
from diagrams.aws.database import Dynamodb, RDS
from diagrams.aws.analytics import AmazonOpensearchService
from diagrams.aws.integration import SQS


def asyn(label=""):
    return L(label=label, style="dashed")


# node height is hardcoded for 13pt labels; larger text overlaps the icon without this
Node._height = 2.1
BG, FG, LINE = "#0F172A", "#E2E8F0", "#94A3B8"
GRAPH = {"dpi": "90", "splines": "spline", "pad": "1.0", "fontsize": "26", "nodesep": "0.8", "ranksep": "0.9", "bgcolor": BG, "fontcolor": FG}
NODE = {"fontcolor": FG, "fontsize": "18"}
EDGE = {"color": LINE}


def L(**kw):
    # Edge() hardcodes its own fontcolor, so edge_attr cannot recolour labels
    return Edge(fontcolor=FG, fontsize="18", **kw)

CLUSTER = {"bgcolor": "#1E293B", "pencolor": "#475569", "fontcolor": FG, "fontsize": "22"}

with Diagram("Storefront — full detail", filename="full", outformat=["png", "svg"],
             direction="LR", show=False, graph_attr=GRAPH, node_attr=NODE, edge_attr=EDGE):
    customer = User("Customer")

    with Cluster("Storefront — React SPA on S3 behind CloudFront", graph_attr=CLUSTER):
        cdn = CloudFront("CloudFront\nCDN · edge cache")
        bucket = S3("React SPA\nS3 static site")
        cdn >> L(label="origin") >> bucket

    gw = APIGateway("Edge Gateway\nAPI Gateway · REST")

    with Cluster("Catalog Service  #public — Products, browse and search", graph_attr=CLUSTER):
        cat_api = Lambda("Catalog API\nLambda · Node 20")
        cat_db = Dynamodb("Products\nDynamoDB")
        cat_idx = AmazonOpensearchService("Product Index\nOpenSearch")
        cat_sync = Lambda("Index Sync\nLambda · stream consumer")
        cat_api >> cat_db
        cat_api >> L(label="search") >> cat_idx
        cat_db >> asyn("product stream") >> cat_sync
        cat_sync >> L(label="reindex") >> cat_idx

    with Cluster("Order Service  #pci — Cart, checkout, fulfillment", graph_attr=CLUSTER):
        ord_api = Lambda("Orders API\nLambda · Node 20")
        ord_db = Dynamodb("Orders\nDynamoDB")
        ord_queue = SQS("Fulfillment Queue\nSQS FIFO")
        ord_worker = Lambda("Fulfillment Worker\nLambda · batch 10")
        ord_api >> ord_db
        ord_api >> asyn("enqueue") >> ord_queue
        ord_queue >> asyn() >> ord_worker
        ord_worker >> L(label="mark shipped") >> ord_db

    with Cluster("Account Service  #pci — Identity and profiles", graph_attr=CLUSTER):
        acc_api = Lambda("Accounts API\nLambda · Node 20")
        acc_db = RDS("Accounts DB\nRDS Postgres 16")
        acc_api >> acc_db

    customer >> L(label="browses") >> cdn
    cdn >> L(label="REST /api") >> gw
    gw >> L(label="browse") >> cat_api
    gw >> L(label="checkout") >> ord_api
    gw >> L(label="profile") >> acc_api
    ord_api >> L(label="price check", constraint="false") >> cat_api
    ord_worker >> L(label="decrement stock", constraint="false") >> cat_api
    ord_api >> L(label="verify identity", constraint="false") >> acc_api
