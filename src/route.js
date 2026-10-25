const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const { GoogleGenAI } = require("@google/genai");
const { decode } = require("@googlemaps/polyline-codec");

// This router is mounted at /api in src/app.js, so each path below is served
// beneath that prefix (for example, /places/search becomes /api/places/search).
const router = express.Router();
// Load the local API keys used by the Google Maps and Gemini requests.
dotenv.config();

// Gemini is used only by the workplace-review analysis endpoint.
const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

// Google APIs return durations as strings such as "123s"; calculations below
// use numeric seconds.
const durationToSeconds = (duration) => {
    return Number(duration.replace('s', ''));
}

// Estimate the distance between two [latitude, longitude] points on Earth.
// Summing these segment distances lets the midpoint helpers follow the route.
const getDistance = (point1, point2) => {

    const [lat1, lng1] = point1;
    const [lat2, lng2] = point2;

    const R = 6371000; // Earth radius in meters

    const toRadians = (degree) => {
        return degree * Math.PI / 180;
    };

    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLng / 2) ** 2;

    const c =
        2 * Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return R * c;
};

// Walk the decoded route until half of the supplied distance has been covered.
// The result is the first encoded route vertex at or beyond that halfway mark.
const getHalfwayPoint = (points, totalRouteDistance) => {

    const halfwayDistance = totalRouteDistance / 2;
    let travelledDistance = 0;
    for (let i = 1; i < points.length; i++) {

        travelledDistance += getDistance(
            points[i - 1],
            points[i]
        );

        if (travelledDistance >= halfwayDistance) {
            return points[i];
        }
    }
    return points[points.length - 1];
};

// GET /api/places/search
// Search Google Places using a human-readable query and return a simplified
// list containing each result's name, address, and coordinates.
router.get('/places/search', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) {
            return res.status(400).json({
                success: false,
                message: 'Query paramter is required'
            })
        }
        const response = await fetch(
            'https://places.googleapis.com/v1/places:searchText',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': ' places.id,places.displayName,places.formattedAddress,places.location'
                },
                body: JSON.stringify({
                    textQuery: query
                }),
            }
        );

        const data = await response.json();

        const places = data.places || [];
        const formattedPlaces = places.map((place) => ({
            name: place.displayName?.text,
            address: place.formattedAddress,
            latitude: place.location?.latitude,
            longitude: place.location?.longitude
        }));


        if (!response.ok) {
            return res.status(response.status).json({
                success: false,
                error: data
            });
        }

        return res.status(200).json({
            success: true,
            count: formattedPlaces.length,
            places: formattedPlaces
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        })
    }
});


// POST /api/places/nearby
// Find up to ten places of one requested type inside a radius around the
// supplied coordinate. The upstream Places response is returned as `data`.
router.post('/places/nearby', async (req, res) => {
    try {

        const { latitude, longitude, radius, type } = req.body;

        if (!latitude || !longitude || !radius || !type) {
            return res.status(400).json({
                success: false,
                message: 'latitude, longitude, radius and type are required'
            })
        }

        const response = await fetch(
            'https://places.googleapis.com/v1/places:searchNearby',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': ' places.id,places.displayName,places.formattedAddress,places.location,places.primaryType'
                },
                body: JSON.stringify({
                    includedTypes: [type],
                    maxResultCount: 10,
                    locationRestriction: {
                        circle: {
                            center: {
                                latitude,
                                longitude
                            },
                            radius
                        }
                    }
                }),
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        return res.status(200).json({
            success: true,
            data
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        })
    }
});


// GET /api/places/:placeId
// Retrieve the requested place's address, ratings, phone number, opening
// hours, and reviews from Google Places.
router.get('/places/:placeId', async (req, res) => {
    try {
        const { placeId } = req.params;
        const response = await fetch(
            `https://places.googleapis.com/v1/places/${placeId}`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': 'id,formattedAddress,rating,userRatingCount,nationalPhoneNumber,regularOpeningHours,reviews'
                }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        return res.status(200).json({
            success: true,
            data
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        })
    }
});

// GET /api/places/:placeId/analyze
// Fetch a place's public reviews, ask Gemini to summarize workplace pros and
// cons, and return its practical assessment and score.
router.get('/places/:placeId/analyze', async (req, res) => {
    try {
        const { placeId } = req.params;
        const response = await fetch(
            `https://places.googleapis.com/v1/places/${placeId}`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': 'id,displayName,formattedAddress,rating,userRatingCount,nationalPhoneNumber,regularOpeningHours,reviews'
                }
            }
        );

        const place = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(place);
        }


        const reviews = (place.reviews || []).map((review) => review.text?.text).filter(Boolean);


        const prompt = `You are analyzing a place for someone who wants to work there.

        Place:
        ${place.displayName?.text}

        Rating:
        ${place.rating}

        Number of ratings:
        ${place.userRatingCount}

        Reviews:
        ${reviews.join("\n\n")}

        Answer:
        1. Is this a good place to work?
        2. What are the positive points?
        3. What are the negative points?
        4. Give a final score out of 10.

        Keep the answer practical and concise.`;

        const result = await ai.models.generateContent({
            model: 'gemini-3.5-flash-lite',
            contents: prompt
        });

        return res.json({
            success: true,
            place: place.displayName?.text,
            analysis: result.text
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        })
    }
});


// POST /api/routes
// Calculate a traffic-aware driving route between two coordinates. The
// response includes distance, duration, and an encoded polyline for reuse by
// the route-search and midpoint endpoints.
router.post('/routes', async (req, res) => {
    try {
        const { originLat, originLng, destinationLat, destinationLng } = req.body;
        const response = await fetch(
            `https://routes.googleapis.com/directions/v2:computeRoutes`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline'
                },
                body: JSON.stringify({
                    origin: {
                        location: {
                            latLng: {
                                latitude: originLat,
                                longitude: originLng
                            }
                        }
                    },
                    destination: {
                        location: {
                            latLng: {
                                latitude: destinationLat,
                                longitude: destinationLng
                            }
                        }
                    },
                    travelMode: "DRIVE",
                    routingPreference: "TRAFFIC_AWARE"
                })
            }
        );

        const data = await response.json();
        if (!response.ok) {
            return res.status(response.status).json(data);
        }
        return res.json({
            success: true,
            route: data.routes?.[0]
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        })
    }
});


// POST /api/places/search-along-route
// Find places matching `query` along a supplied encoded route. Google also
// returns routing summaries for the candidate stops when available.
router.post('/places/search-along-route', async (req, res) => {
    try {
        const { query, encodedPolyline } = req.body;
        const response = await fetch(
            `https://places.googleapis.com/v1/places:searchText`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,routingSummaries'
                },
                body: JSON.stringify({
                    textQuery: query,
                    pageSize: 10,
                    searchAlongRouteParameters: {
                        polyline: {
                            encodedPolyline
                        }
                    }
                }),
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        return res.json({
            success: true,
            places: data.places || [],
            routingSummaries: data.routingSummaries || []
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        })
    }
});


// POST /api/places/search-along-route-detour
// Find route-side places, estimate the extra time for stopping at each one,
// discard stops over maxDetourMinutes, and sort the remaining stops by detour.
// Note: the baseline duration and distance below are fixed sample-route values,
// so detour estimates are only meaningful for that same baseline route.
router.post('/places/search-along-route-detour', async (req, res) => {
    try {
        const { query, encodedPolyline, maxDetourMinutes } = req.body;
        const response = await fetch(
            `https://places.googleapis.com/v1/places:searchText`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,routingSummaries'
                },
                body: JSON.stringify({
                    textQuery: query,
                    pageSize: 20,
                    searchAlongRouteParameters: {
                        polyline: {
                            encodedPolyline
                        }
                    },
                    routingParameters: {
                        travelMode: 'DRIVE',
                        routingPreference: 'TRAFFIC_AWARE'
                    }
                }),
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        const originalRouteDuration = 28536;
        const originalRouteDistance = 396647;

        const placesWithDetour = (data.places || []).map((place, index) => {
            const routingSummary = data.routingSummaries?.[index];

            const firstLeg = routingSummary?.legs?.[0];
            const secondLeg = routingSummary?.legs?.[1];

            const distanceFromOrigin = firstLeg?.distanceMeters || 0;
            const journeyPercentage = (distanceFromOrigin / originalRouteDistance) * 100;

            const firstLegSeconds = firstLeg ? durationToSeconds(firstLeg.duration) : 0;
            const secondLegSeconds = secondLeg ? durationToSeconds(secondLeg.duration) : 0;

            const totalWithStop = firstLegSeconds + secondLegSeconds;
            const detourSeconds = totalWithStop - originalRouteDuration;

            return {
                id: place.id,
                name: place.displayName?.text,
                address: place.formattedAddress,
                detourMinutes: Math.round(detourSeconds / 60),
                journeyPercentage: Math.round(journeyPercentage)
            }
        });

        const filteredPlaces = placesWithDetour.filter((place) => {
            return place.detourMinutes <= maxDetourMinutes;
        })

        filteredPlaces.sort((a, b) => {
            return a.detourMinutes - b.detourMinutes;
        })

        const halfwayPlaces = filteredPlaces.filter((place) => {
            return (
                place.journeyPercentage >= 40 && place.journeyPercentage <= 60
            )
        });


        return res.json({
            success: true,
            places: filteredPlaces
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        })
    }
});


// POST /api/places/halfway-search
// Find places along the full route, while using the route's middle decoded
// vertex as the routing origin. The origin can affect how Google ranks results.
router.post('/places/halfway-search', async (req, res) => {
    try {
        const { query, encodedPolyline } = req.body;

        // Decode the route, then use its middle vertex as a quick midpoint
        // estimate. This is based on vertex count, not total travel distance.
        const decodedPoints = decode(encodedPolyline);
        const middleIndex = Math.floor(decodedPoints.length / 2);
        const halfwayPoint = decodedPoints[middleIndex];

        const halfwayLatitude = halfwayPoint[0];
        const halfwayLongitude = halfwayPoint[1];

        // Keep the search corridor on the complete route but set the routing
        // origin to the midpoint, which can influence result ordering.
        const response = await fetch(
            `https://places.googleapis.com/v1/places:searchText`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    // 'X-Goog-FieldMask': ' places.id,places.displayName,places.formattedAddress,places.location'
                    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,routingSummaries'
                },
                body: JSON.stringify({
                    textQuery: query,
                    pageSize: 20,
                    searchAlongRouteParameters: {
                        polyline: {
                            encodedPolyline
                        }
                    },
                    routingParameters: {
                        origin: {
                            latitude: halfwayLatitude,
                            longitude: halfwayLongitude
                        },
                        travelMode: 'DRIVE',
                        routingPreference: 'TRAFFIC_AWARE'
                    }
                }),
            }
        );

        const data = await response.json();
        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        return res.json({
            success: true,
            halfwayPoint: {
                latitude: halfwayLatitude,
                longitude: halfwayLongitude
            },
            places: data.places || [],
            routingSummaries: data.routingSummaries || []
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        })
    }
});


// POST /api/places/halfway-nearby
// Find matching places along the route, restricted to a rectangular area
// around the route's middle decoded vertex. This is a geographic-area search,
// not a distance-weighted midpoint calculation.
router.post('/places/halfway-nearby', async (req, res) => {
    try {
        const { query, encodedPolyline } = req.body;

        // Decode the route and select its middle vertex as the center of the
        // search rectangle.
        const decodedPoints = decode(encodedPolyline);
        const middleIndex = Math.floor(decodedPoints.length / 2);
        const halfwayPoint = decodedPoints[middleIndex];

        const halfwayLatitude = halfwayPoint[0];
        const halfwayLongitude = halfwayPoint[1];

        const response = await fetch(
            `https://places.googleapis.com/v1/places:searchText`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    // 'X-Goog-FieldMask': ' places.id,places.displayName,places.formattedAddress,places.location'
                    'X-Goog-FieldMask': "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount"
                },
                body: JSON.stringify({
                    textQuery: query,
                    pageSize: 20,
                    searchAlongRouteParameters: {
                        polyline: {
                            encodedPolyline
                        }
                    },
                    locationRestriction: {
                        rectangle: {
                            low: {
                                latitude: halfwayLatitude - 0.25,
                                longitude: halfwayLongitude - 0.25
                            },
                            high: {
                                latitude: halfwayLatitude + 0.25,
                                longitude: halfwayLongitude + 0.25
                            }
                        }
                    }
                }),
            }
        );

        const data = await response.json();
        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        return res.json({
            success: true,
            halfwayPoint: {
                latitude: halfwayLatitude,
                longitude: halfwayLongitude
            },
            places: data.places || []
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        })
    }
});


// POST /api/places/halfway-by-distance
// Find the point halfway through the supplied route distance, then search
// within a rectangle around it. `distanceMeters` should describe the same
// route represented by `encodedPolyline`.
router.post('/places/halfway-by-distance', async (req, res) => {
    try {
        const { query, encodedPolyline, distanceMeters } = req.body;

        const decodedPoints = decode(encodedPolyline);
        const halfwayPoint = getHalfwayPoint(decodedPoints, distanceMeters);

        const halfwayLatitude = halfwayPoint[0];
        const halfwayLongitude = halfwayPoint[1];

        const response = await fetch(
            `https://places.googleapis.com/v1/places:searchText`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    // 'X-Goog-FieldMask': ' places.id,places.displayName,places.formattedAddress,places.location'
                    'X-Goog-FieldMask': "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount"
                },
                body: JSON.stringify({
                    textQuery: query,
                    pageSize: 20,
                    searchAlongRouteParameters: {
                        polyline: {
                            encodedPolyline
                        }
                    },
                    locationRestriction: {
                        rectangle: {
                            low: {
                                latitude: halfwayLatitude - 0.25,
                                longitude: halfwayLongitude - 0.25
                            },
                            high: {
                                latitude: halfwayLatitude + 0.25,
                                longitude: halfwayLongitude + 0.25
                            }
                        }
                    }
                }),
            }
        );

        const data = await response.json();
        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        return res.json({
            success: true,
            halfwayPoint: {
                latitude: halfwayLatitude,
                longitude: halfwayLongitude
            },
            places: data.places || []
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        })
    }
});


// POST /api/road-trip/search
// Run the complete trip-planning flow: calculate a traffic-aware route, find
// its distance-based midpoint, search for places nearby, estimate each stop's
// extra journey time, apply the user's detour limit, and rank recommendations.
router.post('/road-trip/search', async (req, res) => {
    try {
        const {
            originLat,
            originLng,
            destinationLat,
            destinationLng,
            query,
            maxDetourMinutes
        } = req.body;


        // 1. Get the baseline driving route used for later midpoint and detour
        // calculations.
        const routeResponse = await fetch(
            'https://routes.googleapis.com/directions/v2:computeRoutes',
            {
                method: 'POST',

                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask':
                        'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline'
                },

                body: JSON.stringify({
                    origin: {
                        location: {
                            latLng: {
                                latitude: originLat,
                                longitude: originLng
                            }
                        }
                    },

                    destination: {
                        location: {
                            latLng: {
                                latitude: destinationLat,
                                longitude: destinationLng
                            }
                        }
                    },

                    travelMode: 'DRIVE',
                    routingPreference: 'TRAFFIC_AWARE'
                })
            }
        );


        const routeData = await routeResponse.json();

        if (!routeResponse.ok) {
            return res.status(routeResponse.status).json(routeData);
        }


        const route = routeData.routes?.[0];

        if (!route) {
            return res.status(404).json({
                success: false,
                message: 'No route found'
            });
        }

        const distanceMeters = route.distanceMeters;
        const originalRouteDuration = Number(route.duration.replace('s', ''));
        const encodedPolyline = route.polyline.encodedPolyline;


        // 2. Decode the route and walk its vertices until half its reported
        // distance has been covered.
        const decodedPoints = decode(encodedPolyline);
        const halfwayDistance = distanceMeters / 2;
        let travelledDistance = 0;
        let halfwayPoint = decodedPoints[0];

        for (let i = 1; i < decodedPoints.length; i++) {

            const segmentDistance = getDistance(
                decodedPoints[i - 1],
                decodedPoints[i]
            );
            travelledDistance += segmentDistance;
            if (travelledDistance >= halfwayDistance) {
                halfwayPoint =
                    decodedPoints[i];
                break;
            }
        }
        const halfwayLatitude = halfwayPoint[0];
        const halfwayLongitude = halfwayPoint[1];

        // 3. Search along the route, limited to a rectangle around the
        // calculated midpoint.
        const placesResponse = await fetch(
            'https://places.googleapis.com/v1/places:searchText',
            {
                method: 'POST',

                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,

                    'X-Goog-FieldMask':
                        'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,routingSummaries'
                },

                body: JSON.stringify({
                    textQuery: query,
                    pageSize: 20,
                    searchAlongRouteParameters: {
                        polyline: {
                            encodedPolyline
                        }
                    },
                    locationRestriction: {
                        rectangle: {
                            low: {
                                latitude:
                                    halfwayLatitude - 0.25,
                                longitude:
                                    halfwayLongitude - 0.25
                            },
                            high: {
                                latitude:
                                    halfwayLatitude + 0.25,
                                longitude:
                                    halfwayLongitude + 0.25
                            }
                        }
                    },
                    routingParameters: {
                        travelMode: 'DRIVE',
                        routingPreference: 'TRAFFIC_AWARE'
                    }
                })
            }
        );
        const placesData = await placesResponse.json();
        if (!placesResponse.ok) {
            return res.status(placesResponse.status).json(placesData);
        }

        // 4. Google supplies two route legs for each candidate (start to stop,
        // then stop to destination); compare their combined time with the
        // original route duration to estimate the time added by the stop.
        const placesWithDetour = (placesData.places || []).map( (place, index) => {
                    const routingSummary = placesData.routingSummaries?.[index];

                    const firstLeg = routingSummary?.legs?.[0];
                    const secondLeg = routingSummary?.legs?.[1];

                    if (!firstLeg || !secondLeg) { return null; }

                    const firstLegSeconds = durationToSeconds( firstLeg.duration );
                    const secondLegSeconds =durationToSeconds( secondLeg.duration );

                    const totalWithStop = firstLegSeconds + secondLegSeconds;
                    const detourSeconds = totalWithStop - originalRouteDuration;

                    const rating = place.rating || 0;
                    const reviewCount = place.userRatingCount || 0;
                    const detourMinutes = Math.round(detourSeconds / 60);

                    const score = (rating * 20) + Math.min(reviewCount / 100, 20) - detourMinutes;

                    return {
                        id: place.id,
                        name: place.displayName?.text,
                        address: place.formattedAddress,
                        rating: rating,
                        userRatingCount: reviewCount,
                        detourMinutes,
                        score: Math.round(score)
                    };
                }
            ).filter(Boolean);

        // 5. Keep only candidates within the user's allowed added travel time.
        const filteredPlaces =
            placesWithDetour.filter((place) => {

                return place.detourMinutes <=
                    maxDetourMinutes;
            });


        // 6. Rank using rating, review count, and detour; higher scores come
        // first. Despite the historical step label, this is not a detour-only
        // sort.
        filteredPlaces.sort((a, b) => {
            return b.score - a.score;
        });

        // 7. Return the route summary, midpoint, and ranked stop suggestions.
        return res.json({
            success: true,
            halfwayPoint: {
                latitude: halfwayLatitude,
                longitude: halfwayLongitude
            },
            route: {
                distanceMeters,
                durationSeconds: originalRouteDuration
            },
            places: filteredPlaces
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });

    }
});





module.exports = router;