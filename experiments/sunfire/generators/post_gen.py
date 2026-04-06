import json
from pathlib import Path
import random
import uuid
from datetime import datetime, timedelta

count = 1000
listings = []

# Feature Space
property_types = ["condo", "house", "apartment", "land", "material", "construction"]
transaction_types = ["rent", "buy", "none"]

def one_hot(value, choices):
    return [1 if value == c else 0 for c in choices]

def price_bucket(price):
    if price == 0:
        return [0, 0, 0]
    elif price < 500_000:
        return [1, 0, 0]
    elif price < 2_000_000:
        return [0, 1, 0]
    else:
        return [0, 0, 1]

# Location Clusters
centers = [
    (21.96, 96.09),
    (21.70, 96.20),
    (22.30, 96.50),
    (23.00, 97.20),
]

for i in range(count):

    # 1. Category
    category = random.choice(["property", "material", "construction"])

    # 2. Location
    c_lat, c_lng = random.choice(centers)
    lat = c_lat + random.uniform(-0.03, 0.03)
    lng = c_lng + random.uniform(-0.03, 0.03)

    # 3. Time
    days_old = random.uniform(0, 30)
    created_at = (datetime.now() - timedelta(days=days_old)).isoformat()

    # 4. Compliance Score (STRICT > 0.4)
    compliance_score = round(random.uniform(0.41, 1.0), 3)

    # 5. Activity Profile
    # simulate different user behaviors
    activity_type = random.choice(["dead", "casual", "active", "grinder"])

    if activity_type == "dead":
        posts_per_day = random.uniform(0.0, 0.2)
        streak_days = random.randint(0, 5)

    elif activity_type == "casual":
        posts_per_day = random.uniform(0.2, 1.0)
        streak_days = random.randint(3, 30)

    elif activity_type == "active":
        posts_per_day = random.uniform(1.0, 3.0)
        streak_days = random.randint(10, 90)

    else:
        posts_per_day = random.uniform(3.0, 10.0)
        streak_days = random.randint(30, 365)

    # 6. Content Logic
    if category == "property":
        property_type = random.choice(["condo", "house", "apartment", "land"])
        transaction_type = random.choice(["rent", "buy"])
        price = random.randint(200_000, 5_000_000)

    elif category == "material":
        property_type = "material"
        transaction_type = "none"
        price = 0

    else:
        property_type = "construction"
        transaction_type = "none"
        price = 0

    # 7. Feature Vector
    vector = (
        one_hot(property_type, property_types)
        + one_hot(transaction_type, transaction_types)
        + price_bucket(price)
    )

    listing = {
        "id": str(uuid.uuid4())[:8],
        "category": category,
        "title": f"{category.capitalize()} Post {i}",
        "lat": lat,
        "lng": lng,
        "created_at": created_at,
        "price": price,

        # semantic features
        "property_type": property_type,
        "transaction_type": transaction_type,

        # trust system (Sunfire B inputs)
        "authority": {
            "compliance_score": compliance_score,
            "posts_per_day": round(posts_per_day, 2),
            "streak_days": streak_days
        },

        # vector for cosine similarity
        "feature_vector": vector
    }

    listings.append(listing)

# Save
with open('./data/dummy_feed.json', 'w') as f:
    file_path = Path('../data/dummy_feed.json')
    file_path.parent.mkdir(parents=True, exist_ok=True)
    json.dump(listings, f, indent=2)

print(f"Generated {count} feed items → dummy_feed.json")
