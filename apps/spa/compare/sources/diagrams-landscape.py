from diagrams import Node, Diagram, Edge
from diagrams.azure.identity import Users as User  # AWS's user icon is dark-on-transparent
from diagrams.aws.network import CloudFront, APIGateway
from diagrams.aws.compute import Lambda

# node height is hardcoded for 13pt labels; larger text overlaps the icon without this
Node._height = 2.1
BG, FG, LINE = "#0F172A", "#E2E8F0", "#94A3B8"
GRAPH = {"dpi": "150", "splines": "spline", "pad": "1.0", "fontsize": "22", "nodesep": "0.8", "ranksep": "1.0", "bgcolor": BG, "fontcolor": FG}
NODE = {"fontcolor": FG, "fontsize": "18"}
EDGE = {"color": LINE}


def L(**kw):
    # Edge() hardcodes its own fontcolor, so edge_attr cannot recolour labels
    return Edge(fontcolor=FG, fontsize="17", **kw)


with Diagram("Storefront — landscape", filename="landscape", outformat=["png", "svg"],
             direction="TB", show=False, graph_attr=GRAPH, node_attr=NODE, edge_attr=EDGE):
    customer = User("Customer")
    web = CloudFront("Storefront\nReact SPA on S3 behind CloudFront")
    gw = APIGateway("Edge Gateway\nAPI Gateway · REST")
    catalog = Lambda("Catalog Service  #public\nProducts, browse and search")
    orders = Lambda("Order Service  #pci\nCart, checkout, fulfillment")
    accounts = Lambda("Account Service  #pci\nIdentity and profiles")

    customer >> L(label="browses") >> web
    web >> L(label="REST /api") >> gw
    gw >> L(label="browse") >> catalog
    gw >> L(label="checkout") >> orders
    gw >> L(label="profile") >> accounts
    orders >> L(label="price check / decrement stock", constraint="false") >> catalog
    orders >> L(label="verify identity", constraint="false") >> accounts
